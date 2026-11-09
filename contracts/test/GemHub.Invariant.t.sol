// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {GemHub} from "../GemHub.sol";

contract GemHubHandler is Test {
    GemHub public hub;
    uint256 public signerKey;
    address[] public actors;
    uint256 public stakes;
    uint256 public claims;
    uint256 public exits;

    constructor(GemHub hub_, uint256 signerKey_, address[] memory actors_) {
        hub = hub_;
        signerKey = signerKey_;
        actors = actors_;
    }

    function actorsLength() external view returns (uint256) {
        return actors.length;
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[seed % actors.length];
    }

    function claim(uint256 seed, uint256 amount) external {
        address a = _actor(seed);
        amount = bound(amount, 1, 150_000_000 ether);
        uint256 cum = hub.claimed(a) + amount;
        uint256 dl = block.timestamp + 1 days;
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                keccak256(
                    abi.encode(
                        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                        keccak256("HamsterGems"),
                        keccak256("1"),
                        block.chainid,
                        address(hub)
                    )
                ),
                keccak256(
                    abi.encode(
                        keccak256("Claim(address account,uint256 cumulative,uint256 deadline)"), a, cum, dl
                    )
                )
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, digest);
        vm.prank(a);
        try hub.claim(cum, dl, abi.encodePacked(r, s, v)) {
            claims++;
        } catch {}
    }

    function stake(uint256 seed, uint256 amount, uint8 tier) external {
        address a = _actor(seed);
        tier = uint8(bound(tier, 0, 3));
        uint256 bal = hub.balanceOf(a);
        if (bal < 1 ether) return;
        amount = bound(amount, 1 ether, bal);
        vm.prank(a);
        try hub.stake(amount, tier) {
            stakes++;
        } catch {}
    }

    function claimReward(uint256 seed, uint8 tier) external {
        vm.prank(_actor(seed));
        try hub.claimReward(uint8(bound(tier, 0, 3))) {} catch {}
    }

    function unstake(uint256 seed, uint8 tier) external {
        vm.prank(_actor(seed));
        try hub.unstake(uint8(bound(tier, 0, 3))) {
            exits++;
        } catch {}
    }

    function unstakeEarly(uint256 seed, uint8 tier) external {
        vm.prank(_actor(seed));
        try hub.unstakeEarly(uint8(bound(tier, 0, 3))) {
            exits++;
        } catch {}
    }

    function transfer(uint256 seed, uint256 to, uint256 amount) external {
        address from = _actor(seed);
        // recipients: actors, or the hub itself (donation)
        address dst = to % 5 == 0 ? address(hub) : _actor(to);
        amount = bound(amount, 0, hub.balanceOf(from));
        vm.prank(from);
        hub.transfer(dst, amount);
    }

    function warp(uint256 dt) external {
        vm.warp(block.timestamp + bound(dt, 0, 400 days));
    }

    function togglePause(uint256 seed) external {
        vm.prank(hub.owner());
        hub.setPaused(seed % 4 == 0);
    }
}

contract GemHubInvariantTest is Test {
    GemHub internal hub;
    GemHubHandler internal handler;
    address[] internal actors;

    function setUp() public {
        vm.warp(1_700_000_000);
        (address signerAddr, uint256 signerKey) = makeAddrAndKey("signer");
        hub = new GemHub(makeAddr("owner"), signerAddr, 2_000_000_000 ether);
        actors.push(makeAddr("a1"));
        actors.push(makeAddr("a2"));
        actors.push(makeAddr("a3"));
        handler = new GemHubHandler(hub, signerKey, actors);
        targetContract(address(handler));
    }

    /// forge-config: default.invariant.runs = 64
    /// forge-config: default.invariant.depth = 64
    function invariant_HubBalanceCoversTotalStaked() public view {
        assertGe(hub.balanceOf(address(hub)), hub.totalStaked());
    }

    /// forge-config: default.invariant.runs = 64
    /// forge-config: default.invariant.depth = 64
    function invariant_TotalSupplyWithinMax() public view {
        assertLe(hub.totalSupply(), hub.MAX_SUPPLY());
    }

    /// forge-config: default.invariant.runs = 64
    /// forge-config: default.invariant.depth = 64
    function invariant_RewardsWithinBudget() public view {
        assertLe(hub.rewardsMinted(), hub.REWARD_BUDGET());
    }

    /// forge-config: default.invariant.runs = 64
    /// forge-config: default.invariant.depth = 64
    function invariant_SupplyEqualsSumOfBalances() public view {
        uint256 sum = hub.balanceOf(address(hub));
        for (uint256 i; i < actors.length; ++i) sum += hub.balanceOf(actors[i]);
        assertEq(sum, hub.totalSupply());
    }

    /// forge-config: default.invariant.runs = 64
    /// forge-config: default.invariant.depth = 64
    function invariant_TotalStakedEqualsSumOfPositions() public view {
        uint256 sum;
        for (uint256 i; i < actors.length; ++i) {
            for (uint8 t; t < 4; ++t) {
                (uint128 amt,,) = hub.positions(actors[i], t);
                sum += amt;
            }
        }
        assertEq(sum, hub.totalStaked());
    }

    /// forge-config: default.invariant.runs = 64
    /// forge-config: default.invariant.depth = 64
    function invariant_SupplyAtLeastClaimedMinusBurn() public view {
        // supply = claimed + rewards - burned; so supply <= sum(claimed) + rewardsMinted
        uint256 claimedSum;
        for (uint256 i; i < actors.length; ++i) claimedSum += hub.claimed(actors[i]);
        assertLe(hub.totalSupply(), claimedSum + hub.rewardsMinted());
    }
}
