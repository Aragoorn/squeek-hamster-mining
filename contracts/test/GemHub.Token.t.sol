// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {GemHubTestBase} from "./GemHub.Base.t.sol";
import {GemHub} from "../GemHub.sol";

contract GemHubTokenTest is GemHubTestBase {
    // ---------------- deployment ----------------

    function test_Deploy_State() public view {
        assertEq(hub.owner(), owner);
        assertEq(hub.signer(), signerAddr);
        assertEq(hub.globalDailyCap(), CAP);
        assertEq(hub.totalSupply(), 0);
        assertEq(hub.decimals(), 18);
        assertEq(hub.symbol(), "HGEM");
        assertFalse(hub.paused());
        assertEq(hub.MAX_SUPPLY(), 1_000_000_000 ether);
        assertEq(hub.REWARD_BUDGET(), 100_000_000 ether);
    }

    function test_Deploy_EmitsOwnershipAndSignerEvents() public {
        vm.expectEmit(true, true, false, false);
        emit GemHub.OwnershipTransferred(address(0), owner);
        vm.expectEmit(true, true, false, false);
        emit GemHub.SignerUpdated(address(0), signerAddr);
        new GemHub(owner, signerAddr, 5);
    }

    function test_Deploy_RevertsOnZeroOwner() public {
        vm.expectRevert(GemHub.InvalidAddress.selector);
        new GemHub(address(0), signerAddr, 1);
    }

    function test_Deploy_RevertsOnZeroSigner() public {
        vm.expectRevert(GemHub.InvalidAddress.selector);
        new GemHub(owner, address(0), 1);
    }

    function test_Deploy_ZeroCapAllowed() public {
        GemHub h = new GemHub(owner, signerAddr, 0);
        assertEq(h.globalDailyCap(), 0);
    }

    // ---------------- ERC20: transfer ----------------

    function test_Transfer_MovesBalanceAndEmits() public {
        _fund(alice, 100 ether);
        vm.expectEmit(true, true, false, true, address(hub));
        emit GemHub.Transfer(alice, bob, 40 ether);
        vm.prank(alice);
        assertTrue(hub.transfer(bob, 40 ether));
        assertEq(hub.balanceOf(alice), 60 ether);
        assertEq(hub.balanceOf(bob), 40 ether);
        assertEq(hub.totalSupply(), 100 ether);
    }

    function test_Transfer_ZeroAmountOk() public {
        vm.prank(alice);
        assertTrue(hub.transfer(bob, 0));
    }

    function test_Transfer_SelfTransferKeepsBalance() public {
        _fund(alice, 100 ether);
        vm.prank(alice);
        hub.transfer(alice, 100 ether);
        assertEq(hub.balanceOf(alice), 100 ether);
        assertEq(hub.totalSupply(), 100 ether);
    }

    function test_Transfer_RevertsInsufficientBalance() public {
        _fund(alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert(GemHub.InsufficientBalance.selector);
        hub.transfer(bob, 1 ether + 1);
    }

    function test_Transfer_RevertsToZeroAddress() public {
        _fund(alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert(GemHub.InvalidAddress.selector);
        hub.transfer(address(0), 1);
    }

    // ---------------- ERC20: approve / transferFrom ----------------

    function test_Approve_SetsAllowanceAndEmits() public {
        vm.expectEmit(true, true, false, true, address(hub));
        emit GemHub.Approval(alice, bob, 55);
        vm.prank(alice);
        assertTrue(hub.approve(bob, 55));
        assertEq(hub.allowance(alice, bob), 55);
    }

    function test_Approve_RevertsZeroSpender() public {
        vm.prank(alice);
        vm.expectRevert(GemHub.InvalidAddress.selector);
        hub.approve(address(0), 1);
    }

    function test_TransferFrom_SpendsAllowance() public {
        _fund(alice, 100 ether);
        vm.prank(alice);
        hub.approve(bob, 70 ether);
        vm.expectEmit(true, true, false, true, address(hub));
        emit GemHub.Transfer(alice, carol, 30 ether);
        vm.prank(bob);
        assertTrue(hub.transferFrom(alice, carol, 30 ether));
        assertEq(hub.allowance(alice, bob), 40 ether);
        assertEq(hub.balanceOf(carol), 30 ether);
        assertEq(hub.balanceOf(alice), 70 ether);
    }

    function test_TransferFrom_MaxAllowanceNotDecremented() public {
        _fund(alice, 100 ether);
        vm.prank(alice);
        hub.approve(bob, type(uint256).max);
        vm.prank(bob);
        hub.transferFrom(alice, carol, 60 ether);
        assertEq(hub.allowance(alice, bob), type(uint256).max);
        vm.prank(bob);
        hub.transferFrom(alice, carol, 40 ether);
        assertEq(hub.allowance(alice, bob), type(uint256).max);
        assertEq(hub.balanceOf(carol), 100 ether);
    }

    function test_TransferFrom_RevertsInsufficientAllowance() public {
        _fund(alice, 100 ether);
        vm.prank(alice);
        hub.approve(bob, 10 ether);
        vm.prank(bob);
        vm.expectRevert(GemHub.InsufficientAllowance.selector);
        hub.transferFrom(alice, carol, 10 ether + 1);
    }

    function test_TransferFrom_RevertsNoAllowance() public {
        _fund(alice, 100 ether);
        vm.prank(bob);
        vm.expectRevert(GemHub.InsufficientAllowance.selector);
        hub.transferFrom(alice, carol, 1);
    }

    function test_TransferFrom_RevertsInsufficientBalance() public {
        _fund(alice, 5 ether);
        vm.prank(alice);
        hub.approve(bob, type(uint256).max);
        vm.prank(bob);
        vm.expectRevert(GemHub.InsufficientBalance.selector);
        hub.transferFrom(alice, carol, 6 ether);
    }

    function test_TransferFrom_RevertsZeroFrom() public {
        vm.prank(bob);
        vm.expectRevert(GemHub.InvalidAddress.selector);
        hub.transferFrom(address(0), carol, 0);
    }

    function test_TransferFrom_RevertsZeroTo() public {
        _fund(alice, 5 ether);
        vm.prank(alice);
        hub.approve(bob, 5 ether);
        vm.prank(bob);
        vm.expectRevert(GemHub.InvalidAddress.selector);
        hub.transferFrom(alice, address(0), 1 ether);
    }

    // ---------------- ownership & admin ----------------

    function test_TransferOwnership_HappyAndEvent() public {
        vm.expectEmit(true, true, false, false, address(hub));
        emit GemHub.OwnershipTransferred(owner, alice);
        vm.prank(owner);
        hub.transferOwnership(alice);
        assertEq(hub.owner(), alice);

        // old owner locked out, new owner active
        vm.prank(owner);
        vm.expectRevert(GemHub.Unauthorized.selector);
        hub.setPaused(true);
        vm.prank(alice);
        hub.setPaused(true);
        assertTrue(hub.paused());
    }

    function test_TransferOwnership_RevertsNonOwner() public {
        vm.prank(alice);
        vm.expectRevert(GemHub.Unauthorized.selector);
        hub.transferOwnership(alice);
    }

    function test_TransferOwnership_RevertsZero() public {
        vm.prank(owner);
        vm.expectRevert(GemHub.InvalidAddress.selector);
        hub.transferOwnership(address(0));
    }

    function test_NoRenounceFunction() public {
        (bool ok,) = address(hub).call(abi.encodeWithSignature("renounceOwnership()"));
        assertFalse(ok);
        assertEq(hub.owner(), owner);
    }

    function test_NoPublicBurnOrMint() public {
        (bool ok,) = address(hub).call(abi.encodeWithSignature("burn(uint256)", 1));
        assertFalse(ok);
        (ok,) = address(hub).call(abi.encodeWithSignature("mint(address,uint256)", alice, 1));
        assertFalse(ok);
    }

    function test_RejectsEther() public {
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        (bool ok,) = address(hub).call{value: 1}("");
        assertFalse(ok);
    }

    function test_SetSigner_HappyAndEvent() public {
        vm.expectEmit(true, true, false, false, address(hub));
        emit GemHub.SignerUpdated(signerAddr, bob);
        vm.prank(owner);
        hub.setSigner(bob);
        assertEq(hub.signer(), bob);
    }

    function test_SetSigner_Reverts() public {
        vm.prank(alice);
        vm.expectRevert(GemHub.Unauthorized.selector);
        hub.setSigner(bob);
        vm.prank(owner);
        vm.expectRevert(GemHub.InvalidAddress.selector);
        hub.setSigner(address(0));
    }

    function test_SetGlobalDailyCap_HappyAndRevert() public {
        vm.prank(owner);
        hub.setGlobalDailyCap(123);
        assertEq(hub.globalDailyCap(), 123);
        vm.prank(alice);
        vm.expectRevert(GemHub.Unauthorized.selector);
        hub.setGlobalDailyCap(1);
    }

    function test_SetPaused_HappyAndRevert() public {
        vm.prank(owner);
        hub.setPaused(true);
        assertTrue(hub.paused());
        vm.prank(owner);
        hub.setPaused(false);
        assertFalse(hub.paused());
        vm.prank(alice);
        vm.expectRevert(GemHub.Unauthorized.selector);
        hub.setPaused(true);
    }
}
