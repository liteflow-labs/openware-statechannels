// SPDX-License-Identifier: MIT
pragma solidity 0.7.4;
pragma experimental ABIEncoderV2;

import '@statechannels/nitro-protocol/contracts/interfaces/IForceMoveApp.sol';
import '@statechannels/nitro-protocol/contracts/Outcome.sol';

contract Dummy is IForceMoveApp {
    /**
     * @notice Encodes the payment channel update rules.
     * @dev Encodes the payment channel update rules.
     * @param a State being transitioned from.
     * @param b State being transitioned to.
     * @param turnNumB Turn number being transitioned to.
     * @param nParticipants Number of participants in this state channel.
     * @return true if the transition conforms to the rules, false otherwise.
     */
    function validTransition(
        VariablePart memory a,
        VariablePart memory b,
        uint48 turnNumB,
        uint256 nParticipants
    ) public pure override returns (bool) {
        return true;
    }
}
