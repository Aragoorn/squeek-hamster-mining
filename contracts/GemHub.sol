// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title Hamster Gem claims and staking
/// @notice Cumulative EIP-712 claims and self-custodied, single-position staking.
/// @dev No callbacks. Escrow balance >= totalStaked; donations cannot be rescued.
/// Admin setters emit no events (size budget); read state getters instead.
/// Pause blocks only claim and stake. No ownership renunciation or public burning.
/// Tiers (lock days / APR bps / client boost bps): 0/300/10000,
/// 7/800/11000, 30/1500/12500, 90/2500/15000. A year is 365 days.
contract GemHub {
    error InvalidAddress();
    error Unauthorized();
    error InsufficientBalance();
    error InsufficientAllowance();
    error InvalidSignature();
    error Expired();
    error NothingToClaim();
    error CapExceeded();
    error SupplyExceeded();
    error InvalidStake();
    error InvalidTier();
    error InvalidPosition();
    error Locked();
    error NotLocked();
    error EnforcedPause();

    string public constant name = "Hamster Gem";
    string public constant symbol = "HGEM";
    uint8 public constant decimals = 18;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    address public owner;

    uint256 public constant MAX_SUPPLY = 1_000_000_000 ether;
    uint256 public constant REWARD_BUDGET = 100_000_000 ether;
    bytes32 private constant CLAIM_TYPEHASH =
        keccak256("Claim(address account,uint256 cumulative,uint256 deadline)");
    bytes32 private constant DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );
    uint256 private immutable _cachedChainId;
    bytes32 private immutable _cachedDomainSeparator;

    struct Daily {
        uint208 amount;
        uint48 day;
    }

    /// @dev Packed into one slot. Zero amount denotes a closed position.
    struct Position {
        uint128 amount;
        uint48 lockEnd;
        uint48 lastClaim;
    }

    address public signer;
    bool public paused;
    uint256 public globalDailyCap;
    mapping(address => uint256) public claimed;
    Daily private _globalDaily;
    mapping(address => mapping(uint8 => Position)) public positions;
    uint256 public totalStaked;
    uint256 public rewardsMinted;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event SignerUpdated(address indexed previousSigner, address indexed newSigner);
    event Claimed(address indexed account, uint256 amount);
    event Staked(address indexed account, uint8 indexed tier, uint256 amount);
    event RewardClaimed(address indexed account, uint8 indexed tier, uint256 amount);
    event Unstaked(address indexed account, uint8 indexed tier, uint256 returned, uint256 burned);

    /// @notice Initializes without preminting. Zero cap disables signed minting only.
    constructor(address owner_, address signer_, uint256 globalDailyCap_) {
        owner = _nonzero(owner_);
        signer = _nonzero(signer_);
        emit OwnershipTransferred(address(0), owner_);
        emit SignerUpdated(address(0), signer_);
        globalDailyCap = globalDailyCap_;
        _cachedChainId = block.chainid;
        _cachedDomainSeparator = _buildDomainSeparator();
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert EnforcedPause();
        _;
    }

    function transferOwnership(address next) external onlyOwner {
        _nonzero(next);
        emit OwnershipTransferred(owner, next);
        owner = next;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][_nonzero(spender)] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _move(msg.sender, to, amount);
        return true;
    }

    /// @dev Infinite allowance is unchanged; spending does not emit Approval.
    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        _nonzero(from);
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            if (allowed < amount) revert InsufficientAllowance();
            unchecked { allowance[from][msg.sender] = allowed - amount; }
        }
        _move(from, to, amount);
        return true;
    }

    function _move(address from, address to, uint256 amount) internal {
        _nonzero(to);
        uint256 balance = balanceOf[from];
        if (balance < amount) revert InsufficientBalance();
        // Balances sum to totalSupply <= MAX_SUPPLY, including self-transfers.
        unchecked {
            balanceOf[from] = balance - amount;
            balanceOf[to] += amount;
        }
        emit Transfer(from, to, amount);
    }

    /// @dev Callers bound minting by MAX_SUPPLY before entering.
    function _mint(address to, uint256 amount) internal {
        _nonzero(to);
        unchecked {
            totalSupply += amount;
            balanceOf[to] += amount;
        }
        emit Transfer(address(0), to, amount);
    }

    function _burn(address from, uint256 amount) internal {
        _nonzero(from);
        uint256 balance = balanceOf[from];
        if (balance < amount) revert InsufficientBalance();
        unchecked {
            balanceOf[from] = balance - amount;
            totalSupply -= amount;
        }
        emit Transfer(from, address(0), amount);
    }

    /// @notice Mints only the unclaimed difference; replays/non-increasing totals revert.
    /// @dev Domain: HamsterGems/1, chainId, this contract. All accounting precedes mint.
    function claim(uint256 cumulative, uint256 deadline, bytes calldata signature) external whenNotPaused {
        if (block.timestamp > deadline) revert Expired();
        bytes32 domain = block.chainid == _cachedChainId
            ? _cachedDomainSeparator : _buildDomainSeparator();
        bytes32 digest = keccak256(abi.encodePacked(
            "\x19\x01", domain,
            keccak256(abi.encode(CLAIM_TYPEHASH, msg.sender, cumulative, deadline))
        ));
        if (signature.length != 65) revert InvalidSignature();
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly ("memory-safe") {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
        if ((v != 27 && v != 28) || uint256(s) >
            0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0
        ) revert InvalidSignature();
        address recovered = ecrecover(digest, v, r, s);
        if (recovered == address(0) || recovered != signer) revert InvalidSignature();
        uint256 previous = claimed[msg.sender];
        if (cumulative <= previous) revert NothingToClaim();
        uint256 delta;
        unchecked { delta = cumulative - previous; }
        if (delta > MAX_SUPPLY - totalSupply) revert SupplyExceeded();
        uint256 globalAmount = globalMintedToday() + delta;
        if (globalAmount > globalDailyCap) revert CapExceeded();
        claimed[msg.sender] = cumulative;
        // Burns permit reissuance: explicitly bound the packed daily counter.
        if (globalAmount > type(uint208).max) revert CapExceeded();
        _globalDaily = Daily(uint208(globalAmount), uint48(block.timestamp / 1 days));
        _mint(msg.sender, delta);
        emit Claimed(msg.sender, delta);
    }

    /// @notice Signed-claim usage in the current UTC day; staking rewards are excluded.
    function globalMintedToday() public view returns (uint256) {
        Daily memory d = _globalDaily;
        return d.day == block.timestamp / 1 days ? d.amount : 0;
    }

    function setSigner(address next) external onlyOwner {
        _nonzero(next);
        emit SignerUpdated(signer, next);
        signer = next;
    }

    function setGlobalDailyCap(uint256 cap) external onlyOwner {
        globalDailyCap = cap;
    }

    function setPaused(bool value) external onlyOwner {
        paused = value;
    }

    /// @dev Packed constants: lock days 0/7/30/90 (bytes) and APR bps 300/800/1500/2500 (uint16).
    function _tier(uint8 tier) private pure returns (uint256 lockDays, uint256 apr) {
        if (tier > 3) revert InvalidTier();
        lockDays = (0x5A1E0700 >> (uint256(tier) * 8)) & 0xff;
        apr = (0x09C405DC0320012C >> (uint256(tier) * 16)) & 0xffff;
    }

    /// @notice Stakes >= 1 HGEM without approval; top-ups checkpoint rewards first.
    /// @dev Resets accrual to now and extends the lock. Matured lock gaps earn nothing.
    function stake(uint256 amount, uint8 tier) external whenNotPaused {
        if (amount < 1 ether || amount > MAX_SUPPLY) revert InvalidStake();
        (uint256 lockDays,) = _tier(tier);
        Position storage p = positions[msg.sender][tier];
        if (p.amount != 0) _checkpoint(p, tier);
        // Successful transfers imply aggregate principal <= supply, which fits uint128.
        p.amount = uint128(uint256(p.amount) + amount);
        uint48 end = uint48(block.timestamp + lockDays * 1 days);
        if (end > p.lockEnd) p.lockEnd = end;
        p.lastClaim = uint48(block.timestamp);
        totalStaked += amount;
        _move(msg.sender, address(this), amount);
        emit Staked(msg.sender, tier, amount);
    }

    /// @notice Pays checkpointed rewards even while paused; clipped rewards/dust are lost.
    function claimReward(uint8 tier) external {
        _checkpoint(_position(tier), tier);
    }

    /// @notice Returns principal and rewards after maturity; tier zero exits anytime.
    function unstake(uint8 tier) external {
        _exit(tier, false);
    }

    /// @notice Exits a still-locked tier, forfeiting rewards and burning floor(principal/5).
    /// @dev Both exit paths remain available while paused and when reward capacity is zero.
    function unstakeEarly(uint8 tier) external {
        _exit(tier, true);
    }

    function _exit(uint8 tier, bool early) private {
        Position storage p = _position(tier);
        uint256 burned;
        if (early) {
            if (tier == 0 || block.timestamp >= p.lockEnd) revert NotLocked();
            burned = p.amount / 5;
        } else {
            if (block.timestamp < p.lockEnd) revert Locked();
            _checkpoint(p, tier);
        }
        uint256 amount = p.amount;
        delete positions[msg.sender][tier];
        unchecked {
            totalStaked -= amount;
            amount -= burned;
        }
        if (burned != 0) _burn(address(this), burned);
        _move(address(this), msg.sender, amount);
        emit Unstaked(msg.sender, tier, amount, burned);
    }

    function _buildDomainSeparator() private view returns (bytes32) {
        return keccak256(abi.encode(
            DOMAIN_TYPEHASH, keccak256("HamsterGems"), keccak256("1"), block.chainid, address(this)
        ));
    }

    function _nonzero(address account) private pure returns (address) {
        if (account == address(0)) revert InvalidAddress();
        return account;
    }

    function _position(uint8 tier) private view returns (Position storage p) {
        if (tier > 3) revert InvalidTier();
        p = positions[msg.sender][tier];
        if (p.amount == 0) revert InvalidPosition();
    }

    /// @dev Locked rewards stop at maturity; flexible rewards continue until checkpoint.
    function _checkpoint(Position storage p, uint8 tier) private {
        uint256 end = block.timestamp;
        if (tier != 0 && end > p.lockEnd) end = p.lockEnd;
        (, uint256 apr) = _tier(tier);
        uint256 reward = uint256(p.amount) * apr * (end - p.lastClaim) / (365 days * 10000);
        uint256 remaining = REWARD_BUDGET - rewardsMinted;
        if (reward > remaining) reward = remaining;
        remaining = MAX_SUPPLY - totalSupply;
        if (reward > remaining) reward = remaining;
        p.lastClaim = uint48(end);
        unchecked { rewardsMinted += reward; }
        if (reward != 0) _mint(msg.sender, reward);
        emit RewardClaimed(msg.sender, tier, reward);
    }
}
