//
// Flow 4.2
// Same as 4.1 with ephemeral keys
//

import { HashZero } from '@ethersproject/constants'
import { Wallet } from '@ethersproject/wallet'
import {
  Channel,
  ContractArtifacts,
  getFixedPart,
  getVariablePart,
  signChallengeMessage,
  SignedState,
  signState,
  signStates,
  State,
} from '@statechannels/nitro-protocol'
import { ethers } from 'hardhat'
import { NitroAdjudicator } from '../types'
import { assertChannelMode } from './assert'

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

  // TrivialApp
  const TrivialApp = await ethers.getContractFactory('TrivialApp')
  const trivialApp = await TrivialApp.deploy()
  await trivialApp.deployed()

  // participants
  const ephemeralKeys = [
    Wallet.createRandom(),
    Wallet.createRandom(),
    Wallet.createRandom(),
  ]
  console.log('Participants', ephemeralKeys.map((s) => s.address).join(', '))

  // Construct a final state
  const chainId = (await ethers.provider.getNetwork()).chainId.toString()
  const channelNonce = 0
  const channel: Channel = {
    chainId,
    channelNonce,
    participants: ephemeralKeys.map((s) => s.address),
  }

  const states: State[] = [
    {
      isFinal: false,
      channel,
      outcome: [],
      appDefinition: trivialApp.address,
      appData: HashZero,
      challengeDuration: 2,
      turnNum: 3, // state of participant #1
    },
    {
      isFinal: false,
      channel,
      outcome: [],
      appDefinition: trivialApp.address,
      appData: HashZero,
      challengeDuration: 2,
      turnNum: 4, // state of participant #2
    },
    {
      isFinal: false,
      channel,
      outcome: [],
      appDefinition: trivialApp.address,
      appData: HashZero,
      challengeDuration: 2,
      turnNum: 5, // state of participant #3
    },
  ]

  const fixedPart = getFixedPart(states[0])
  const isFinalCount = 0

  // Generate a finalization proof
  await (async () => {
    console.log('Signing...')
    const whoSignedWhat = [0, 1, 2] // the order if forced. at least one must sign last state. each signer MUST signs their dedicated state (turnNum) or one after
    const signatures = await signStates(states, ephemeralKeys, whoSignedWhat)

    // challenger, sign last state (which it didn't sign in the previous signatures)
    const challengeSignedState: SignedState = signState(
      states[states.length - 1],
      ephemeralKeys[0].privateKey,
    )
    const challengeSignature = signChallengeMessage(
      [challengeSignedState],
      ephemeralKeys[0].privateKey,
    )

    // Call challenging
    console.log('Challenging...')
    const variableParts = states.map((state) => getVariablePart(state))
    const largestTurnNum = states[states.length - 1].turnNum
    const tx = await nitroAdjudicator.challenge(
      fixedPart,
      largestTurnNum,
      variableParts,
      isFinalCount,
      signatures,
      whoSignedWhat,
      challengeSignature,
    )
    await tx.wait()
  })()

  await assertChannelMode(nitroAdjudicator, channel, 'Challenge')

  await (async () => {
    // create a new state
    states.push({
      isFinal: false,
      channel,
      outcome: [],
      appDefinition: trivialApp.address,
      appData: HashZero,
      challengeDuration: 2,
      turnNum: 6, // state of participant #1
    })
    states.shift() // remove unnecessary states (3 participants for 3 states)
    console.log('Signing...')
    const whoSignedWhat = [2, 0, 1] // the order if forced. at least one must sign last state. each signer MUST signs their dedicated state (turnNum) or one after
    const signatures = await signStates(states, ephemeralKeys, whoSignedWhat)

    // call checkpoint
    const largestTurnNum = states[states.length - 1].turnNum
    const variableParts = states.map((state) => getVariablePart(state))
    const tx = await nitroAdjudicator.checkpoint(
      fixedPart,
      largestTurnNum,
      variableParts,
      isFinalCount,
      signatures,
      whoSignedWhat,
    )
    await tx.wait()
  })()

  await assertChannelMode(nitroAdjudicator, channel, 'Open')
}

main()
  .then(() => {
    console.log('Done')
  })
  .catch((error) => {
    throw error
  })
