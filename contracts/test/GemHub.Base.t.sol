// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {GemHub} from "../GemHub.sol";

abstract contract GemHubTestBase is Test {
    GemHub internal hub;

    address internal owner = makeAddr("owner");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");
    address internal signerAddr;
    uint256 internal signerKey;

    uint256 internal constant CAP = 2_000_000_000 ether; // effectively unlimited by default
    uint256 internal constant START = 1_700_000_000;
    uint256 internal constant SECP_N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;
    bytes32 internal constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 internal constant CLAIM_TYPEHASH =
        keccak256("Claim(address account,uint256 cumulative,uint256 deadline)");

    function setUp() public virtual {
        vm.warp(START);
        (signerAddr, signerKey) = makeAddrAndKey("signer");
        hub = new GemHub(owner, signerAddr, CAP);
    }

    // ---------------- signing helpers ----------------

    function _domainFor(address verifying) internal view returns (bytes32) {
        return keccak256(
            abi.encode(DOMAIN_TYPEHASH, keccak256("HamsterGems"), keccak256("1"), block.chainid, verifying)
        );
    }

    function _digestFor(address verifying, address account, uint256 cumulative, uint256 deadline)
        internal
        view
        returns (bytes32)
    {
        return keccak256(
            abi.encodePacked(
                "\x19\x01",
                _domainFor(verifying),
                keccak256(abi.encode(CLAIM_TYPEHASH, account, cumulative, deadline))
            )
        );
    }

    function _rsv(uint256 pk, address account, uint256 cumulative, uint256 deadline)
        internal
        view
        returns (uint8 v, bytes32 r, bytes32 s)
    {
        (v, r, s) = vm.sign(pk, _digestFor(address(hub), account, cumulative, deadline));
    }

    function _sign(uint256 pk, address account, uint256 cumulative, uint256 deadline)
        internal
        view
        returns (bytes memory)
    {
        (uint8 v, bytes32 r, bytes32 s) = _rsv(pk, account, cumulative, deadline);
        return abi.encodePacked(r, s, v);
    }

    function _claimAs(address who, uint256 cumulative) internal {
        uint256 deadline = block.timestamp + 1 days;
        bytes memory sig = _sign(signerKey, who, cumulative, deadline);
        vm.prank(who);
        hub.claim(cumulative, deadline, sig);
    }

    /// @dev Give `who` exactly `amount` more HGEM via a signed claim.
    function _fund(address who, uint256 amount) internal {
        _claimAs(who, hub.claimed(who) + amount);
    }

    // ---------------- staking helpers ----------------

    function _stake(address who, uint256 amount, uint8 tier) internal {
        vm.prank(who);
        hub.stake(amount, tier);
    }

    function _pos(address who, uint8 tier) internal view returns (uint128 amount, uint48 lockEnd, uint48 lastClaim) {
        return hub.positions(who, tier);
    }

    function _apr(uint8 tier) internal pure returns (uint256) {
        if (tier == 0) return 300;
        if (tier == 1) return 800;
        if (tier == 2) return 1500;
        return 2500;
    }

    function _lockDays(uint8 tier) internal pure returns (uint256) {
        if (tier == 0) return 0;
        if (tier == 1) return 7;
        if (tier == 2) return 30;
        return 90;
    }

    function _expectedReward(uint256 amount, uint8 tier, uint256 secs) internal pure returns (uint256) {
        return amount * _apr(tier) * secs / (365 days * 10000);
    }
}
