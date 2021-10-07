// Source: https://github.com/statechannels/statechannels/blob/44c88c10f674745c741ecfaa7bebb15bb15323e8/packages/nitro-protocol/contracts/TrivialApp.sol
// SPDX-License-Identifier: MIT
pragma solidity 0.7.4;
pragma experimental ABIEncoderV2;

import '@statechannels/nitro-protocol/contracts/interfaces/IForceMoveApp.sol';
import '@statechannels/nitro-protocol/contracts/Outcome.sol';

/**
 * @dev The Trivialp contracts complies with the ForceMoveApp interface and allows all transitions, regardless of the data. Used for testing purposes.
 */
contract TrivialApp is IForceMoveApp {
    /**
     * @notice Encodes trivial rules.
     * @dev Encodes trivial rules.
     * @return true.
     */
    function validTransition(
        VariablePart memory, // a
        VariablePart memory, // b
        uint48, // turnNumB
        uint256 // nParticipants
    ) public pure override returns (bool) {
        return true;
    }
}
