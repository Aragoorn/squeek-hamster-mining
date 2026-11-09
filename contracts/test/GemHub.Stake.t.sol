// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {GemHubTestBase} from "./GemHub.Base.t.sol";
import {GemHub} from "../GemHub.sol";

contract GemHubStakeTest is GemHubTestBase {
    uint256 internal constant P = 1000 ether;

    function setUp() public override {
        super.setUp();
        _fund(alice, 10_000 ether);
        _fund(bob, 10_000 ether);
    }

    // ---------------- stake ----------------

    function test_Stake_HappyPathAllTiers() public {
        for (uint8 t; t < 4; ++t) {
            uint256 balBefore = hub.balanceOf(alice);
            vm.expectEmit(true, true, false, true, address(hub));
            emit GemHub.Staked(alice, t, P);
            _stake(alice, P, t);
            (uint128 amt, uint48 lockEnd, uint48 last) = _pos(alice, t);
            assertEq(amt, P);
            assertEq(lockEnd, block.timestamp + _lockDays(t) * 1 days);
            assertEq(last, block.timestamp);
            assertEq(hub.balanceOf(alice), balBefore - P);
        }
        assertEq(hub.totalStaked(), 4 * P);
        assertEq(hub.balanceOf(address(hub)), 4 * P);
    }

    function test_Stake_EmitsTransferToHub() public {
        vm.expectEmit(true, true, false, true, address(hub));
        emit GemHub.Transfer(alice, address(hub), P);
        _stake(alice, P, 1);
    }

    function test_Stake_MinimumBoundary() public {
        _stake(alice, 1 ether, 0);
        (uint128 amt,,) = _pos(alice, 0);
        assertEq(amt, 1 ether);
        vm.prank(bob);
        vm.expectRevert(GemHub.InvalidStake.selector);
        hub.stake(1 ether - 1, 0);
    }

    function test_Stake_ZeroReverts() public {
        vm.prank(alice);
        vm.expectRevert(GemHub.InvalidStake.selector);
        hub.stake(0, 0);
    }

    function test_Stake_AboveMaxSupplyReverts() public {
        uint256 over = hub.MAX_SUPPLY() + 1;
        vm.prank(alice);
        vm.expectRevert(GemHub.InvalidStake.selector);
        hub.stake(over, 0);
    }

    function test_Stake_InvalidTierReverts() public {
        vm.prank(alice);
        vm.expectRevert(GemHub.InvalidTier.selector);
        hub.stake(P, 4);
    }

    function test_Stake_InsufficientBalanceReverts() public {
        vm.prank(alice);
        vm.expectRevert(GemHub.InsufficientBalance.selector);
        hub.stake(10_001 ether, 0);
    }

    function test_Stake_TiersAreIndependentPositions() public {
        _stake(alice, P, 1);
        _stake(bob, 2 * P, 1);
        _stake(alice, 3 * P, 2);
        (uint128 a1,,) = _pos(alice, 1);
        (uint128 b1,,) = _pos(bob, 1);
        (uint128 a2,,) = _pos(alice, 2);
        assertEq(a1, P);
        assertEq(b1, 2 * P);
        assertEq(a2, 3 * P);
    }

    // ---------------- reward math ----------------

    function _lockedRewardAtMaturity(uint8 t) internal {
        _stake(alice, P, t);
        skip(_lockDays(t) * 1 days);
        uint256 expected = _expectedReward(P, t, _lockDays(t) * 1 days);
        uint256 before = hub.balanceOf(alice);
        vm.expectEmit(true, true, false, true, address(hub));
        emit GemHub.RewardClaimed(alice, t, expected);
        vm.expectEmit(true, true, false, true, address(hub));
        emit GemHub.Unstaked(alice, t, P, 0);
        vm.prank(alice);
        hub.unstake(t);
        assertEq(hub.balanceOf(alice), before + P + expected);
        assertEq(hub.rewardsMinted(), expected);
        assertEq(hub.totalStaked(), 0);
    }

    function test_Reward_Tier1AtMaturity() public {
        _lockedRewardAtMaturity(1);
    }

    function test_Reward_Tier2AtMaturity() public {
        _lockedRewardAtMaturity(2);
    }

    function test_Reward_Tier3AtMaturity() public {
        _lockedRewardAtMaturity(3);
    }

    function test_Reward_ExactKnownValues() public {
        // 1000 HGEM @ 8% for 7 days = 1000e18 * 800 * 7d / (365d*10000)
        _stake(alice, P, 1);
        skip(7 days);
        vm.prank(alice);
        hub.claimReward(1);
        uint256 p = P;
        assertEq(hub.rewardsMinted(), p * 800 * 7 / (365 * 10000));
    }

    function test_Reward_Tier0AccruesContinuously() public {
        _stake(alice, P, 0);
        skip(365 days);
        uint256 before = hub.balanceOf(alice);
        vm.prank(alice);
        hub.unstake(0);
        assertEq(hub.balanceOf(alice), before + P + 30 ether); // 3% of 1000
    }

    function test_Reward_AccrualStopsAtLockEnd() public {
        _stake(alice, P, 1);
        skip(7 days + 400 days);
        uint256 before = hub.balanceOf(alice);
        vm.prank(alice);
        hub.unstake(1);
        assertEq(hub.balanceOf(alice), before + P + _expectedReward(P, 1, 7 days));
    }

    function test_Reward_NoDoublePayAfterMaturityClaim() public {
        _stake(alice, P, 1);
        skip(30 days);
        vm.prank(alice);
        hub.claimReward(1);
        uint256 minted = hub.rewardsMinted();
        assertEq(minted, _expectedReward(P, 1, 7 days));
        skip(30 days);
        vm.prank(alice);
        hub.claimReward(1);
        assertEq(hub.rewardsMinted(), minted);
    }

    // ---------------- claimReward ----------------

    function test_ClaimReward_MidLockPaysAndKeepsPrincipal() public {
        _stake(alice, P, 2);
        skip(10 days);
        uint256 expected = _expectedReward(P, 2, 10 days);
        uint256 before = hub.balanceOf(alice);
        vm.expectEmit(true, true, false, true, address(hub));
        emit GemHub.RewardClaimed(alice, 2, expected);
        vm.prank(alice);
        hub.claimReward(2);
        assertEq(hub.balanceOf(alice), before + expected);
        (uint128 amt, uint48 lockEnd, uint48 last) = _pos(alice, 2);
        assertEq(amt, P);
        assertEq(last, block.timestamp);
        assertEq(lockEnd, START + 30 days);
        assertEq(hub.totalStaked(), P);
    }

    function test_ClaimReward_NoPositionReverts() public {
        vm.prank(alice);
        vm.expectRevert(GemHub.InvalidPosition.selector);
        hub.claimReward(0);
    }

    function test_ClaimReward_InvalidTierReverts() public {
        vm.prank(alice);
        vm.expectRevert(GemHub.InvalidTier.selector);
        hub.claimReward(9);
    }

    function test_ClaimReward_OnlyCallerPositionCounts() public {
        _stake(alice, P, 0);
        skip(30 days);
        vm.prank(bob);
        vm.expectRevert(GemHub.InvalidPosition.selector);
        hub.claimReward(0);
    }

    // ---------------- unstake ----------------

    function test_Unstake_Tier0AnytimeEvenSameBlock() public {
        _stake(alice, P, 0);
        uint256 before = hub.balanceOf(alice);
        vm.expectEmit(true, true, false, true, address(hub));
        emit GemHub.Unstaked(alice, 0, P, 0);
        vm.prank(alice);
        hub.unstake(0);
        assertEq(hub.balanceOf(alice), before + P);
        (uint128 amt, uint48 lockEnd, uint48 last) = _pos(alice, 0);
        assertEq(amt, 0);
        assertEq(lockEnd, 0);
        assertEq(last, 0);
    }

    function test_Unstake_LockedRevertsUntilMaturity() public {
        _stake(alice, P, 1);
        vm.prank(alice);
        vm.expectRevert(GemHub.Locked.selector);
        hub.unstake(1);
        skip(7 days - 1);
        vm.prank(alice);
        vm.expectRevert(GemHub.Locked.selector);
        hub.unstake(1);
        skip(1);
        vm.prank(alice);
        hub.unstake(1);
    }

    function test_Unstake_NoPositionOrBadTierReverts() public {
        vm.prank(alice);
        vm.expectRevert(GemHub.InvalidPosition.selector);
        hub.unstake(3);
        vm.prank(alice);
        vm.expectRevert(GemHub.InvalidTier.selector);
        hub.unstake(4);
    }

    function test_Unstake_TwiceReverts() public {
        _stake(alice, P, 0);
        vm.startPrank(alice);
        hub.unstake(0);
        vm.expectRevert(GemHub.InvalidPosition.selector);
        hub.unstake(0);
        vm.stopPrank();
    }

    // ---------------- unstakeEarly ----------------

    function test_UnstakeEarly_BurnsTwentyPercentAndForfeitsReward() public {
        _stake(alice, P, 3);
        skip(45 days);
        uint256 supplyBefore = hub.totalSupply();
        uint256 balBefore = hub.balanceOf(alice);
        vm.expectEmit(true, true, false, true, address(hub));
        emit GemHub.Transfer(address(hub), address(0), 200 ether);
        vm.expectEmit(true, true, false, true, address(hub));
        emit GemHub.Unstaked(alice, 3, 800 ether, 200 ether);
        vm.prank(alice);
        hub.unstakeEarly(3);
        assertEq(hub.balanceOf(alice), balBefore + 800 ether);
        assertEq(hub.totalSupply(), supplyBefore - 200 ether);
        assertEq(hub.rewardsMinted(), 0);
        assertEq(hub.totalStaked(), 0);
        (uint128 amt,,) = _pos(alice, 3);
        assertEq(amt, 0);
    }

    function test_UnstakeEarly_BurnFloorsOddPrincipal() public {
        uint256 amt = 1 ether + 3;
        _stake(alice, amt, 1);
        uint256 balBefore = hub.balanceOf(alice);
        vm.prank(alice);
        hub.unstakeEarly(1);
        uint256 burned = amt / 5;
        assertEq(hub.balanceOf(alice), balBefore + amt - burned);
    }

    function test_UnstakeEarly_Tier0Reverts() public {
        _stake(alice, P, 0);
        vm.prank(alice);
        vm.expectRevert(GemHub.NotLocked.selector);
        hub.unstakeEarly(0);
    }

    function test_UnstakeEarly_AfterMaturityReverts() public {
        _stake(alice, P, 1);
        skip(7 days);
        vm.prank(alice);
        vm.expectRevert(GemHub.NotLocked.selector);
        hub.unstakeEarly(1);
    }

    function test_UnstakeEarly_NoPositionAndBadTierRevert() public {
        vm.prank(alice);
        vm.expectRevert(GemHub.InvalidPosition.selector);
        hub.unstakeEarly(2);
        vm.prank(alice);
        vm.expectRevert(GemHub.InvalidTier.selector);
        hub.unstakeEarly(5);
    }

    function test_UnstakeEarly_DoesNotChangeClaimedTotal() public {
        // burned supply is not re-credited to claimed
        _stake(alice, P, 2);
        vm.prank(alice);
        hub.unstakeEarly(2);
        assertEq(hub.claimed(alice), 10_000 ether);
    }

    // ---------------- top-up ----------------

    function test_TopUp_CheckpointsRewardAndExtendsLock() public {
        _stake(alice, P, 1);
        skip(3 days);
        uint256 expected = _expectedReward(P, 1, 3 days);
        uint256 before = hub.balanceOf(alice);
        vm.expectEmit(true, true, false, true, address(hub));
        emit GemHub.RewardClaimed(alice, 1, expected);
        _stake(alice, 500 ether, 1);
        // reward minted (+) and 500 deposited (-)
        assertEq(hub.balanceOf(alice), before + expected - 500 ether);
        (uint128 amt, uint48 lockEnd, uint48 last) = _pos(alice, 1);
        assertEq(amt, 1500 ether);
        assertEq(lockEnd, START + 3 days + 7 days);
        assertEq(last, START + 3 days);
        // new principal accrues from the top-up
        skip(7 days);
        vm.prank(alice);
        hub.unstake(1);
        assertEq(hub.rewardsMinted(), expected + _expectedReward(1500 ether, 1, 7 days));
    }

    function test_TopUp_AfterMaturityOnlyPaysUntilLockEndThenRelocks() public {
        _stake(alice, P, 1);
        skip(20 days);
        _stake(alice, P, 1);
        assertEq(hub.rewardsMinted(), _expectedReward(P, 1, 7 days)); // gap earns nothing
        (uint128 amt, uint48 lockEnd, uint48 last) = _pos(alice, 1);
        assertEq(amt, 2 * P);
        assertEq(lockEnd, START + 20 days + 7 days);
        assertEq(last, START + 20 days);
        vm.prank(alice);
        vm.expectRevert(GemHub.Locked.selector);
        hub.unstake(1);
    }

    function test_TopUp_Tier0() public {
        _stake(alice, P, 0);
        skip(365 days);
        _stake(alice, P, 0);
        assertEq(hub.rewardsMinted(), 30 ether);
        (uint128 amt,, uint48 last) = _pos(alice, 0);
        assertEq(amt, 2 * P);
        assertEq(last, block.timestamp);
    }

    function test_TopUp_ReopenAfterFullExit() public {
        _stake(alice, P, 1);
        vm.prank(alice);
        hub.unstakeEarly(1);
        skip(100 days);
        _stake(alice, 10 ether, 1);
        assertEq(hub.rewardsMinted(), 0); // fresh position: no stale accrual
        (uint128 amt, uint48 lockEnd,) = _pos(alice, 1);
        assertEq(amt, 10 ether);
        assertEq(lockEnd, block.timestamp + 7 days);
    }

    // ---------------- budget / supply clipping ----------------

    function test_Clip_RewardBudgetCapsRewards() public {
        address whale = makeAddr("whale");
        _fund(whale, 400_000_000 ether);
        _stake(whale, 400_000_000 ether, 0);
        skip(3650 days); // 10 years @3% on 400M = 120M > 100M budget
        vm.prank(whale);
        hub.claimReward(0);
        assertEq(hub.rewardsMinted(), hub.REWARD_BUDGET());
        // further rewards are zero, nothing else minted
        uint256 supply = hub.totalSupply();
        skip(365 days);
        vm.expectEmit(true, true, false, true, address(hub));
        emit GemHub.RewardClaimed(whale, 0, 0);
        vm.prank(whale);
        hub.claimReward(0);
        assertEq(hub.totalSupply(), supply);
        assertEq(hub.rewardsMinted(), hub.REWARD_BUDGET());
        // principal still fully recoverable when budget is exhausted
        uint256 before = hub.balanceOf(whale);
        vm.prank(whale);
        hub.unstake(0);
        assertEq(hub.balanceOf(whale), before + 400_000_000 ether);
    }

    function test_Clip_MaxSupplyCapsRewards() public {
        address whale = makeAddr("whale");
        uint256 almost = hub.MAX_SUPPLY() - hub.totalSupply() - 0.5 ether;
        _fund(whale, almost);
        assertEq(hub.MAX_SUPPLY() - hub.totalSupply(), 0.5 ether);
        _stake(whale, almost, 0);
        skip(365 days);
        vm.prank(whale);
        hub.claimReward(0);
        assertEq(hub.totalSupply(), hub.MAX_SUPPLY());
        assertEq(hub.rewardsMinted(), 0.5 ether);
        // supply full: another claim mints nothing but does not revert, exit still works
        skip(365 days);
        vm.prank(whale);
        hub.unstake(0);
        assertEq(hub.totalSupply(), hub.MAX_SUPPLY());
        assertEq(hub.rewardsMinted(), 0.5 ether);
    }

    function test_Clip_SignedClaimBlockedWhenSupplyFull() public {
        address whale = makeAddr("whale");
        _fund(whale, hub.MAX_SUPPLY() - hub.totalSupply());
        uint256 dl = block.timestamp + 1 days;
        uint256 cum = hub.claimed(alice) + 1;
        bytes memory sig = _sign(signerKey, alice, cum, dl);
        vm.prank(alice);
        vm.expectRevert(GemHub.SupplyExceeded.selector);
        hub.claim(cum, dl, sig);
    }
}
