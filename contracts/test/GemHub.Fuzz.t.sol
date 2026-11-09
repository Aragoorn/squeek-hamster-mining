// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {GemHubTestBase} from "./GemHub.Base.t.sol";
import {GemHub} from "../GemHub.sol";

contract GemHubFuzzTest is GemHubTestBase {
    // ---------------- reward math ----------------

    function testFuzz_Reward_MatchesFormulaAndCapsAtLockEnd(uint256 amount, uint8 tier, uint256 elapsed) public {
        tier = uint8(bound(tier, 0, 3));
        amount = bound(amount, 1 ether, 100_000_000 ether);
        elapsed = bound(elapsed, 0, 5 * 365 days);
        _fund(alice, amount);
        _stake(alice, amount, tier);
        skip(elapsed);

        uint256 accrual = elapsed;
        if (tier != 0 && elapsed > _lockDays(tier) * 1 days) accrual = _lockDays(tier) * 1 days;
        uint256 expected = _expectedReward(amount, tier, accrual);

        if (tier != 0 && elapsed < _lockDays(tier) * 1 days) {
            vm.prank(alice);
            vm.expectRevert(GemHub.Locked.selector);
            hub.unstake(tier);
            return;
        }
        vm.prank(alice);
        hub.unstake(tier);
        assertEq(hub.balanceOf(alice), amount + expected);
        assertEq(hub.rewardsMinted(), expected);
        assertEq(hub.totalSupply(), amount + expected);
        assertEq(hub.totalStaked(), 0);
    }

    function testFuzz_Reward_MonotonicInTime(uint256 amount, uint256 t1, uint256 t2) public {
        amount = bound(amount, 1 ether, 10_000_000 ether);
        t1 = bound(t1, 0, 3 * 365 days);
        t2 = bound(t2, t1, 3 * 365 days);
        _fund(alice, amount);
        _fund(bob, amount);
        _stake(alice, amount, 0);
        _stake(bob, amount, 0);
        skip(t1);
        vm.prank(alice);
        hub.unstake(0);
        uint256 a = hub.balanceOf(alice);
        skip(t2 - t1);
        vm.prank(bob);
        hub.unstake(0);
        assertGe(hub.balanceOf(bob), a);
    }

    function testFuzz_Reward_CheckpointSplitNeverExceedsSingleShot(uint256 amount, uint256 t1, uint256 t2) public {
        amount = bound(amount, 1 ether, 10_000_000 ether);
        t1 = bound(t1, 0, 365 days);
        t2 = bound(t2, 0, 365 days);
        _fund(alice, amount);
        _stake(alice, amount, 0);
        skip(t1);
        vm.prank(alice);
        hub.claimReward(0);
        skip(t2);
        vm.prank(alice);
        hub.claimReward(0);
        // rounding can only lose dust, never gain
        assertLe(hub.rewardsMinted(), _expectedReward(amount, 0, t1 + t2));
        assertGe(hub.rewardsMinted() + 2, _expectedReward(amount, 0, t1 + t2));
    }

    function testFuzz_TopUp_PreservesPrincipalAndLockMonotonic(uint256 a1, uint256 a2, uint256 dt, uint8 tier) public {
        tier = uint8(bound(tier, 0, 3));
        a1 = bound(a1, 1 ether, 1_000_000 ether);
        a2 = bound(a2, 1 ether, 1_000_000 ether);
        dt = bound(dt, 0, 200 days);
        _fund(alice, a1 + a2);
        _stake(alice, a1, tier);
        (, uint48 lock1,) = _pos(alice, tier);
        skip(dt);
        _stake(alice, a2, tier);
        (uint128 amt, uint48 lock2, uint48 last) = _pos(alice, tier);
        assertEq(amt, a1 + a2);
        assertGe(lock2, lock1);
        assertEq(last, block.timestamp);
        assertEq(hub.totalStaked(), a1 + a2);
    }

    function testFuzz_UnstakeEarly_BurnsFifthAndConservesPrincipal(uint256 amount, uint8 tier, uint256 dt) public {
        tier = uint8(bound(tier, 1, 3));
        amount = bound(amount, 1 ether, 500_000_000 ether);
        dt = bound(dt, 0, _lockDays(tier) * 1 days - 1);
        _fund(alice, amount);
        _stake(alice, amount, tier);
        skip(dt);
        vm.prank(alice);
        hub.unstakeEarly(tier);
        uint256 burned = amount / 5;
        assertEq(hub.balanceOf(alice), amount - burned);
        assertEq(hub.totalSupply(), amount - burned);
        assertEq(hub.rewardsMinted(), 0);
        assertEq(hub.balanceOf(address(hub)), 0);
    }

    // ---------------- claims ----------------

    function testFuzz_Claim_BalanceEqualsMaxOfCumulatives(uint256 c1, uint256 c2) public {
        c1 = bound(c1, 1, 400_000_000 ether);
        c2 = bound(c2, 1, 400_000_000 ether);
        _claimAs(alice, c1);
        uint256 dl = block.timestamp + 1 days;
        bytes memory sig = _sign(signerKey, alice, c2, dl);
        vm.prank(alice);
        if (c2 <= c1) {
            vm.expectRevert(GemHub.NothingToClaim.selector);
            hub.claim(c2, dl, sig);
        } else {
            hub.claim(c2, dl, sig);
        }
        uint256 expected = c2 > c1 ? c2 : c1;
        assertEq(hub.balanceOf(alice), expected);
        assertEq(hub.totalSupply(), expected);
        assertEq(hub.claimed(alice), expected);
    }

    function testFuzz_Claim_TamperedCumulativeRejected(uint256 signed_, uint256 submitted) public {
        signed_ = bound(signed_, 1, 1_000_000 ether);
        vm.assume(submitted != signed_);
        uint256 dl = block.timestamp + 1 days;
        bytes memory sig = _sign(signerKey, alice, signed_, dl);
        vm.prank(alice);
        vm.expectRevert(GemHub.InvalidSignature.selector);
        hub.claim(submitted, dl, sig);
    }

    function testFuzz_Claim_AnyOtherKeyRejected(uint256 key, uint256 cum) public {
        key = bound(key, 1, SECP_N - 1);
        vm.assume(key != signerKey);
        cum = bound(cum, 1, 1_000_000 ether);
        uint256 dl = block.timestamp + 1 days;
        bytes memory sig = _sign(key, alice, cum, dl);
        vm.prank(alice);
        vm.expectRevert(GemHub.InvalidSignature.selector);
        hub.claim(cum, dl, sig);
    }

    function testFuzz_Claim_WrongAccountRejected(address other, uint256 cum) public {
        vm.assume(other != alice);
        cum = bound(cum, 1, 1_000_000 ether);
        uint256 dl = block.timestamp + 1 days;
        bytes memory sig = _sign(signerKey, alice, cum, dl);
        vm.prank(other);
        vm.expectRevert(GemHub.InvalidSignature.selector);
        hub.claim(cum, dl, sig);
    }

    function testFuzz_Claim_HighSAlwaysRejected(uint256 cum) public {
        cum = bound(cum, 1, 1_000_000 ether);
        uint256 dl = block.timestamp + 1 days;
        (uint8 v, bytes32 r, bytes32 s) = _rsv(signerKey, alice, cum, dl);
        bytes memory bad = abi.encodePacked(r, bytes32(SECP_N - uint256(s)), v == 27 ? uint8(28) : uint8(27));
        vm.prank(alice);
        vm.expectRevert(GemHub.InvalidSignature.selector);
        hub.claim(cum, dl, bad);
    }

    function testFuzz_Claim_DailyCapNeverExceeded(uint256 cap, uint256 c1, uint256 c2) public {
        cap = bound(cap, 1 ether, 1_000_000 ether);
        c1 = bound(c1, 1, 2_000_000 ether);
        c2 = bound(c2, 1, 2_000_000 ether);
        vm.prank(owner);
        hub.setGlobalDailyCap(cap);
        uint256 dl = block.timestamp + 1 days;
        bytes memory s1 = _sign(signerKey, alice, c1, dl);
        bytes memory s2 = _sign(signerKey, bob, c2, dl);
        vm.prank(alice);
        try hub.claim(c1, dl, s1) {} catch {}
        vm.prank(bob);
        try hub.claim(c2, dl, s2) {} catch {}
        assertLe(hub.globalMintedToday(), cap);
        assertEq(hub.globalMintedToday(), hub.totalSupply());
    }

    function testFuzz_Claim_ExpiredAlwaysRejected(uint256 late) public {
        late = bound(late, 1, 100 * 365 days);
        uint256 dl = block.timestamp + 1 hours;
        bytes memory sig = _sign(signerKey, alice, 1 ether, dl);
        vm.warp(dl + late);
        vm.prank(alice);
        vm.expectRevert(GemHub.Expired.selector);
        hub.claim(1 ether, dl, sig);
    }

    function testFuzz_Claim_BadLengthRejected(uint8 len) public {
        vm.assume(len != 65);
        uint256 dl = block.timestamp + 1 days;
        bytes memory sig = new bytes(len);
        vm.prank(alice);
        vm.expectRevert(GemHub.InvalidSignature.selector);
        hub.claim(1 ether, dl, sig);
    }

    // ---------------- ERC20 ----------------

    function testFuzz_Transfer_ConservesTotal(uint256 minted, uint256 amt) public {
        minted = bound(minted, 1, 1_000_000_000 ether);
        amt = bound(amt, 0, minted);
        _fund(alice, minted);
        vm.prank(alice);
        hub.transfer(bob, amt);
        assertEq(hub.balanceOf(alice) + hub.balanceOf(bob), minted);
        assertEq(hub.balanceOf(bob), amt);
    }

    function testFuzz_TransferFrom_AllowanceAccounting(uint256 allowance_, uint256 amt) public {
        _fund(alice, 1_000 ether);
        amt = bound(amt, 0, 1_000 ether);
        vm.prank(alice);
        hub.approve(bob, allowance_);
        vm.prank(bob);
        if (allowance_ < amt) {
            vm.expectRevert(GemHub.InsufficientAllowance.selector);
            hub.transferFrom(alice, carol, amt);
        } else {
            hub.transferFrom(alice, carol, amt);
            uint256 expectedAllowance = allowance_ == type(uint256).max ? allowance_ : allowance_ - amt;
            assertEq(hub.allowance(alice, bob), expectedAllowance);
            assertEq(hub.balanceOf(carol), amt);
        }
    }
}
