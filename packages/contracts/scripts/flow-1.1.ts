//
// Flow 1
// All participants sign the last finale state
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
import { assertChannelMode } from './assert'
import { signStateWithSigner, wait } from './utils'

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
  const state: State = {
    isFinal: true,
    channel,
    outcome: [],
    appDefinition: AddressZero,
    appData: HashZero,
    challengeDuration: 86400, // 1 day
    turnNum: largestTurnNum,
  }

  // Generate a finalization proof
  console.log('Signing...')
  const whoSignedWhat = [0, 0, 0]
  const signatures = await Promise.all(
    signers.map((s) => signStateWithSigner(state, s)),
  )
  // Call conclude
  console.log('Concluding...')
  const numStates = 1
  const fixedPart = getFixedPart(state)
  const appPartHash = hashAppPart(state)
  const outcomeHash = hashOutcome(state.outcome)
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

  console.log('Waiting 1s...')
  await wait(1000)

  await assertChannelMode(nitroAdjudicator, channel, 'Finalized')
}

main()
  .then(() => {
    console.log('Done')
  })
  .catch((error) => {
    throw error
  })
