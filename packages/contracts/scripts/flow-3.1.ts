//
// Flow 3.1
// Same as 3 but without private keys (except for challenger)
//

import { HashZero } from '@ethersproject/constants'
import { HDNode } from '@ethersproject/hdnode'
import {
  Channel,
  ContractArtifacts,
  getFixedPart,
  getVariablePart,
  signChallengeMessage,
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

  // TrivialApp
  const TrivialApp = await ethers.getContractFactory('TrivialApp')
  const trivialApp = await TrivialApp.deploy()
  await trivialApp.deployed()

  // participants
  const signers = (await ethers.getSigners()).slice(-3)
  const participants = signers.map((s) => s.address)
  console.log('Participants', participants.join(', '))

  // Construct a final state
  const chainId = (await ethers.provider.getNetwork()).chainId.toString()
  const channelNonce = 0
  const channel: Channel = { chainId, channelNonce, participants }

  const states: State[] = [
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
    {
      isFinal: false,
      channel,
      outcome: [],
      appDefinition: trivialApp.address,
      appData: HashZero,
      challengeDuration: 2,
      turnNum: 6, // state of participant #1
    },
  ]

  const isFinalCount = 0
  console.log('States:')
  console.table(states)

  // Generate a finalization proof
  console.log('Signing...')
  const whoSignedWhat = [2, 0, 1] // at least one must sign last state. each signer MUST signs their dedicated state (turnNum) or one after
  const signatures = await Promise.all(
    signers.map((s, i) => signStateWithSigner(states[whoSignedWhat[i]], s)),
  )

  // challenger, sign last state (which it didn't sign in the previous signatures)
  const challengeSignedState = await signStateWithSigner(
    states[states.length - 1],
    signers[0],
  )

  const hdnode = HDNode.fromMnemonic(
    'test test test test test test test test test test test junk',
  )
  const challengerPrivateKey = hdnode.derivePath("m/44'/60'/0'/0/17").privateKey
  const challengeSignature = signChallengeMessage(
    [
      {
        signature: challengeSignedState,
        state: states[states.length - 1],
      },
    ],
    challengerPrivateKey,
  )

  // Call challenging
  console.log('Challenging...')
  const fixedPart = getFixedPart(states[0])
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

  await assertChannelMode(nitroAdjudicator, channel, 'Challenge')

  console.log('Waiting 5s...')
  await wait(5000)

  await assertChannelMode(nitroAdjudicator, channel, 'Finalized')
}

main()
  .then(() => {
    console.log('Done')
  })
  .catch((error) => {
    throw error
  })
