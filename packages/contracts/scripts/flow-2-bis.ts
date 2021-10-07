//
// Flow 2
// 2 states. all participants sign the last one
// sign using custom signature functions without access to private key
//

import { AddressZero, HashZero } from '@ethersproject/constants'
import {
  Channel,
  ContractArtifacts,
  getFixedPart,
  hashAppPart,
  hashOutcome,
  State,
} from '@statechannels/nitro-protocol'
import { ethers } from 'hardhat'
import { NitroAdjudicator } from '../types'
import { signStateWithSigner } from './utils'

async function main() {
  // Deploying smart contract
  console.log('Deploying smart contracts...')

  // NitroAdjudicator
  const NitroAdjudicator = await ethers.getContractFactory(
    ContractArtifacts.NitroAdjudicatorArtifact.abi,
    ContractArtifacts.NitroAdjudicatorArtifact.bytecode,
  )
  const nitroAdjudicator = (await NitroAdjudicator.deploy()) as NitroAdjudicator
  await nitroAdjudicator.deployed()

  // participants
  const signers = (await ethers.getSigners()).slice(-3)
  const participants = signers.map((s) => s.address)
  console.log('Participants', participants.join(', '))

  // Construct a final state
  const chainId = (await ethers.provider.getNetwork()).chainId.toString()
  const channelNonce = 0
  const channel: Channel = { chainId, channelNonce, participants }
  const largestTurnNum = 4

  const states: State[] = [
    {
      isFinal: false,
      channel,
      outcome: [],
      appDefinition: AddressZero,
      appData: HashZero,
      challengeDuration: 86400, // 1 day
      turnNum: largestTurnNum - 1,
    },
    {
      isFinal: true,
      channel,
      outcome: [],
      appDefinition: AddressZero,
      appData: HashZero,
      challengeDuration: 86400, // 1 day
      turnNum: largestTurnNum,
    },
  ]

  // Generate a finalization proof
  console.log('Signing...')
  const whoSignedWhat = [1, 1, 1] // everyone sign the last state (index is 1)
  const signatures = await Promise.all(
    signers.map((s, i) => signStateWithSigner(states[whoSignedWhat[i]], s)),
  )

  // Call conclude
  console.log('Concluding...')
  const numStates = states.length
  const fixedPart = getFixedPart(states[0])
  const appPartHash = hashAppPart(states[0])
  const outcomeHash = hashOutcome(states[1].outcome)
  const tx = await nitroAdjudicator.conclude(
    largestTurnNum,
    fixedPart,
    appPartHash,
    outcomeHash,
    numStates,
    whoSignedWhat,
    signatures,
  )
  await tx.wait()
}

main()
  .then(() => {
    console.log('Done')
  })
  .catch((error) => {
    throw error
  })
