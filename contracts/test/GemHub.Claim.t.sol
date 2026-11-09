// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {GemHubTestBase} from "./GemHub.Base.t.sol";
import {GemHub} from "../GemHub.sol";

contract GemHubClaimTest is GemHubTestBase {
    function _tryClaim(address who, uint256 cum, uint256 deadline, bytes memory sig) internal {
        vm.prank(who);
        hub.claim(cum, deadline, sig);
    }

    function test_Claim_HappyMintsAndEmits() public {
        uint256 dl = block.timestamp + 1 hours;
        bytes memory sig = _sign(signerKey, alice, 100 ether, dl);
        vm.expectEmit(true, true, false, true, address(hub));
        emit GemHub.Transfer(address(0), alice, 100 ether);
        vm.expectEmit(true, false, false, true, address(hub));
        emit GemHub.Claimed(alice, 100 ether);
        _tryClaim(alice, 100 ether, dl, sig);
        assertEq(hub.balanceOf(alice), 100 ether);
        assertEq(hub.totalSupply(), 100 ether);
        assertEq(hub.claimed(alice), 100 ether);
        assertEq(hub.globalMintedToday(), 100 ether);
    }

    function test_Claim_CumulativeMintsOnlyDelta() public {
        _claimAs(alice, 100 ether);
        uint256 dl = block.timestamp + 1 hours;
        bytes memory sig = _sign(signerKey, alice, 250 ether, dl);
        vm.expectEmit(true, false, false, true, address(hub));
        emit GemHub.Claimed(alice, 150 ether);
        _tryClaim(alice, 250 ether, dl, sig);
        assertEq(hub.balanceOf(alice), 250 ether);
        assertEq(hub.claimed(alice), 250 ether);
    }

    function test_Claim_ReplayCannotOverMint() public {
        uint256 dl = block.timestamp + 1 hours;
        bytes memory sig = _sign(signerKey, alice, 100 ether, dl);
        _tryClaim(alice, 100 ether, dl, sig);
        vm.expectRevert(GemHub.NothingToClaim.selector);
        _tryClaim(alice, 100 ether, dl, sig);
        assertEq(hub.balanceOf(alice), 100 ether);
    }

    function test_Claim_OldLowerVoucherCannotOverMint() public {
        uint256 dl = block.timestamp + 1 hours;
        bytes memory oldSig = _sign(signerKey, alice, 100 ether, dl);
        bytes memory newSig = _sign(signerKey, alice, 300 ether, dl);
        _tryClaim(alice, 300 ether, dl, newSig);
        vm.expectRevert(GemHub.NothingToClaim.selector);
        _tryClaim(alice, 100 ether, dl, oldSig);
        assertEq(hub.balanceOf(alice), 300 ether);
        assertEq(hub.totalSupply(), 300 ether);
    }

    function test_Claim_OldVoucherAfterSpendingStillNoOverMint() public {
        uint256 dl = block.timestamp + 1 hours;
        bytes memory sig = _sign(signerKey, alice, 100 ether, dl);
        _tryClaim(alice, 100 ether, dl, sig);
        vm.prank(alice);
        hub.transfer(bob, 100 ether); // alice balance now 0, but claimed is still 100
        vm.expectRevert(GemHub.NothingToClaim.selector);
        _tryClaim(alice, 100 ether, dl, sig);
        assertEq(hub.totalSupply(), 100 ether);
    }

    function test_Claim_ZeroCumulativeNothingToClaim() public {
        uint256 dl = block.timestamp + 1 hours;
        bytes memory sig = _sign(signerKey, alice, 0, dl);
        vm.expectRevert(GemHub.NothingToClaim.selector);
        _tryClaim(alice, 0, dl, sig);
    }

    function test_Claim_ExpiredReverts() public {
        uint256 dl = block.timestamp + 1 hours;
        bytes memory sig = _sign(signerKey, alice, 100 ether, dl);
        vm.warp(dl + 1);
        vm.expectRevert(GemHub.Expired.selector);
        _tryClaim(alice, 100 ether, dl, sig);
    }

    function test_Claim_AtDeadlineStillValid() public {
        uint256 dl = block.timestamp + 1 hours;
        bytes memory sig = _sign(signerKey, alice, 100 ether, dl);
        vm.warp(dl);
        _tryClaim(alice, 100 ether, dl, sig);
        assertEq(hub.balanceOf(alice), 100 ether);
    }

    function test_Claim_WrongSignerReverts() public {
        (, uint256 otherKey) = makeAddrAndKey("other");
        uint256 dl = block.timestamp + 1 hours;
        bytes memory sig = _sign(otherKey, alice, 100 ether, dl);
        vm.expectRevert(GemHub.InvalidSignature.selector);
        _tryClaim(alice, 100 ether, dl, sig);
    }

    function test_Claim_WrongAccountReverts() public {
        uint256 dl = block.timestamp + 1 hours;
        bytes memory sig = _sign(signerKey, alice, 100 ether, dl);
        vm.expectRevert(GemHub.InvalidSignature.selector);
        _tryClaim(bob, 100 ether, dl, sig);
    }

    function test_Claim_TamperedCumulativeReverts() public {
        uint256 dl = block.timestamp + 1 hours;
        bytes memory sig = _sign(signerKey, alice, 100 ether, dl);
        vm.expectRevert(GemHub.InvalidSignature.selector);
        _tryClaim(alice, 101 ether, dl, sig);
    }

    function test_Claim_TamperedDeadlineReverts() public {
        uint256 dl = block.timestamp + 1 hours;
        bytes memory sig = _sign(signerKey, alice, 100 ether, dl);
        vm.expectRevert(GemHub.InvalidSignature.selector);
        _tryClaim(alice, 100 ether, dl + 1 days, sig);
    }

    function test_Claim_WrongVerifyingContractReverts() public {
        GemHub other = new GemHub(owner, signerAddr, CAP);
        uint256 dl = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, _digestFor(address(other), alice, 1 ether, dl));
        vm.expectRevert(GemHub.InvalidSignature.selector);
        _tryClaim(alice, 1 ether, dl, abi.encodePacked(r, s, v));
    }

    function test_Claim_HighSMalleableSignatureRejected() public {
        uint256 dl = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _rsv(signerKey, alice, 100 ether, dl);
        bytes32 s2 = bytes32(SECP_N - uint256(s));
        uint8 v2 = v == 27 ? 28 : 27;
        // the malleated signature is a valid ecrecover for the same signer ...
        assertEq(ecrecover(_digestFor(address(hub), alice, 100 ether, dl), v2, r, s2), signerAddr);
        // ... but the contract must reject it
        vm.expectRevert(GemHub.InvalidSignature.selector);
        _tryClaim(alice, 100 ether, dl, abi.encodePacked(r, s2, v2));
        // original still works
        _tryClaim(alice, 100 ether, dl, abi.encodePacked(r, s, v));
        assertEq(hub.balanceOf(alice), 100 ether);
    }

    function test_Claim_WrongLengthSignatureReverts() public {
        uint256 dl = block.timestamp + 1 hours;
        bytes memory sig = _sign(signerKey, alice, 100 ether, dl);
        vm.expectRevert(GemHub.InvalidSignature.selector);
        _tryClaim(alice, 100 ether, dl, "");
        vm.expectRevert(GemHub.InvalidSignature.selector);
        _tryClaim(alice, 100 ether, dl, abi.encodePacked(sig, uint8(0)));
        bytes memory short = new bytes(64);
        for (uint256 i; i < 64; ++i) short[i] = sig[i];
        vm.expectRevert(GemHub.InvalidSignature.selector);
        _tryClaim(alice, 100 ether, dl, short);
    }

    function test_Claim_BadVReverts() public {
        uint256 dl = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _rsv(signerKey, alice, 100 ether, dl);
        vm.expectRevert(GemHub.InvalidSignature.selector);
        _tryClaim(alice, 100 ether, dl, abi.encodePacked(r, s, v - 27)); // 0/1 form
        vm.expectRevert(GemHub.InvalidSignature.selector);
        _tryClaim(alice, 100 ether, dl, abi.encodePacked(r, s, uint8(29)));
    }

    function test_Claim_GarbageSignatureReverts() public {
        uint256 dl = block.timestamp + 1 hours;
        vm.expectRevert(GemHub.InvalidSignature.selector);
        _tryClaim(alice, 1 ether, dl, abi.encodePacked(bytes32(0), bytes32(0), uint8(27)));
    }

    function test_Claim_SupplyExceeded() public {
        uint256 over = hub.MAX_SUPPLY() + 1;
        uint256 dl = block.timestamp + 1 hours;
        bytes memory sig = _sign(signerKey, alice, over, dl);
        vm.expectRevert(GemHub.SupplyExceeded.selector);
        _tryClaim(alice, over, dl, sig);
        _claimAs(alice, hub.MAX_SUPPLY()); // exactly max is fine
        assertEq(hub.totalSupply(), hub.MAX_SUPPLY());
    }

    // ---------------- global daily cap ----------------

    function test_Cap_ExceededRevertsAndExactCapAllowed() public {
        vm.prank(owner);
        hub.setGlobalDailyCap(100 ether);
        uint256 dl = block.timestamp + 1 hours;
        bytes memory tooMuch = _sign(signerKey, alice, 100 ether + 1, dl);
        vm.expectRevert(GemHub.CapExceeded.selector);
        _tryClaim(alice, 100 ether + 1, dl, tooMuch);
        _claimAs(alice, 100 ether);
        assertEq(hub.globalMintedToday(), 100 ether);
    }

    function test_Cap_SharedAcrossAccountsThenNextDayRetry() public {
        vm.prank(owner);
        hub.setGlobalDailyCap(100 ether);
        // align to a fresh UTC day so the +1 day arithmetic is clean
        // (via-ir may cache block.timestamp across vm.warp, so use absolute values)
        uint256 day1 = (START / 1 days + 1) * 1 days;
        vm.warp(day1 + 1 hours);
        _claimAs(alice, 60 ether);
        uint256 dl = day1 + 3 days;
        bytes memory sigBob = _sign(signerKey, bob, 60 ether, dl);
        vm.expectRevert(GemHub.CapExceeded.selector);
        _tryClaim(bob, 60 ether, dl, sigBob);
        assertEq(hub.balanceOf(bob), 0);
        // next UTC day: counter resets, same voucher works
        vm.warp(day1 + 1 days);
        assertEq(hub.globalMintedToday(), 0);
        _tryClaim(bob, 60 ether, dl, sigBob);
        assertEq(hub.balanceOf(bob), 60 ether);
        assertEq(hub.globalMintedToday(), 60 ether);
    }

    function test_Cap_ZeroCapDisablesClaims() public {
        vm.prank(owner);
        hub.setGlobalDailyCap(0);
        uint256 dl = block.timestamp + 1 hours;
        bytes memory sig = _sign(signerKey, alice, 1, dl);
        vm.expectRevert(GemHub.CapExceeded.selector);
        _tryClaim(alice, 1, dl, sig);
    }

    function test_Cap_StakingRewardsDoNotCountTowardCap() public {
        _fund(alice, 1000 ether);
        _stake(alice, 1000 ether, 0);
        skip(365 days);
        uint256 usedBefore = hub.globalMintedToday();
        vm.prank(alice);
        hub.claimReward(0);
        assertEq(hub.globalMintedToday(), usedBefore);
    }

    // ---------------- chain id ----------------

    function test_ChainId_ChangeRecomputesDomain() public {
        uint256 dl = block.timestamp + 1 days;
        bytes memory sigOld = _sign(signerKey, alice, 10 ether, dl);
        vm.chainId(block.chainid + 1);
        // signature built for the deployment chain no longer valid
        vm.expectRevert(GemHub.InvalidSignature.selector);
        _tryClaim(alice, 10 ether, dl, sigOld);
        // signature built for the new chain id is valid
        bytes memory sigNew = _sign(signerKey, alice, 10 ether, dl);
        _tryClaim(alice, 10 ether, dl, sigNew);
        assertEq(hub.balanceOf(alice), 10 ether);
    }

    function test_ChainId_RestoredUsesOriginalDomain() public {
        uint256 original = block.chainid;
        uint256 dl = block.timestamp + 1 days;
        vm.chainId(original + 5);
        vm.chainId(original);
        bytes memory sig = _sign(signerKey, alice, 10 ether, dl);
        _tryClaim(alice, 10 ether, dl, sig);
        assertEq(hub.balanceOf(alice), 10 ether);
    }

    // ---------------- signer rotation ----------------

    function test_SetSigner_OldVoucherInvalidNewValid() public {
        (address newSigner, uint256 newKey) = makeAddrAndKey("newSigner");
        uint256 dl = block.timestamp + 1 days;
        bytes memory oldSig = _sign(signerKey, alice, 5 ether, dl);
        vm.prank(owner);
        hub.setSigner(newSigner);
        vm.expectRevert(GemHub.InvalidSignature.selector);
        _tryClaim(alice, 5 ether, dl, oldSig);
        _tryClaim(alice, 5 ether, dl, _sign(newKey, alice, 5 ether, dl));
        assertEq(hub.balanceOf(alice), 5 ether);
    }

    // ---------------- pause ----------------

    function test_Pause_BlocksClaimAndStake() public {
        _fund(alice, 100 ether);
        vm.prank(owner);
        hub.setPaused(true);
        uint256 dl = block.timestamp + 1 days;
        bytes memory sig = _sign(signerKey, bob, 5 ether, dl);
        vm.expectRevert(GemHub.EnforcedPause.selector);
        _tryClaim(bob, 5 ether, dl, sig);
        vm.prank(alice);
        vm.expectRevert(GemHub.EnforcedPause.selector);
        hub.stake(10 ether, 0);
        // unpause restores
        vm.prank(owner);
        hub.setPaused(false);
        _tryClaim(bob, 5 ether, dl, sig);
        _stake(alice, 10 ether, 0);
    }

    function test_Pause_DoesNotBlockExitsRewardsOrTransfers() public {
        _fund(alice, 1000 ether);
        _stake(alice, 100 ether, 0);
        _stake(alice, 100 ether, 1);
        _stake(alice, 100 ether, 2);
        skip(10 days);
        vm.prank(owner);
        hub.setPaused(true);

        vm.startPrank(alice);
        hub.claimReward(0); // flexible reward
        hub.unstake(0);
        hub.unstake(1); // matured after 7 days
        hub.unstakeEarly(2); // still locked
        hub.transfer(bob, 1 ether);
        hub.approve(bob, 1 ether);
        vm.stopPrank();

        (uint128 a0,,) = _pos(alice, 0);
        (uint128 a1,,) = _pos(alice, 1);
        (uint128 a2,,) = _pos(alice, 2);
        assertEq(a0 + a1 + a2, 0);
        assertEq(hub.totalStaked(), 0);
    }
}
