import { formatEther, formatUnits, parseUnits } from '@ethersproject/units'
import { channelDataToStatus } from '@statechannels/nitro-protocol'
import { abi as NitroAdjudicatorContractAbi } from '@statechannels/nitro-protocol/lib/artifacts/contracts/NitroAdjudicator.sol/NitroAdjudicator.json'
import { parseStatus } from '@statechannels/nitro-protocol/lib/src/contract/channel-storage'
import Head from 'next/head'
import { useMemo } from 'react'
import { NitroAdjudicator } from '../contracts'
import useChannel from '../hooks/useChannel'
import useContract from '../hooks/useContract'
import useStates from '../hooks/useStates'
import useWallet from '../hooks/useWallet'

// TODO: must implement the ephemeral keys in the participants but keep the real wallet in the outcomes

const NitroAdjudicatorContractAddress =
  '0x5FbDB2315678afecb367f032d93F642f64180aa3'
const TrivialAppContractAddress = '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512'

export default function Home(): JSX.Element {
  const { account, chainId, signer, balance, fetchBalance, activateWallet } =
    useWallet()

  const nitroAdjudicatorContract = useContract<NitroAdjudicator>(
    NitroAdjudicatorContractAddress,
    NitroAdjudicatorContractAbi,
  )

  const {
    channel,
    channelNonce,
    setChannelNonce,
    channelId,
    channelMode,
    fetchChannelMode,
    channelHoldings,
    fetchChannelHoldings,
    addNewParticipant,
  } = useChannel(chainId, nitroAdjudicatorContract, TrivialAppContractAddress)

  const {
    states,
    dispatchStates,
    deposit,
    conclude,
    transferToOther,
    challenge,
    withdrawAllAssets,
  } = useStates(TrivialAppContractAddress, nitroAdjudicatorContract)

  const channelStatus = useMemo(() => {
    if (!states.length) return
    const lastState = states[states.length - 1]
    return channelDataToStatus({
      turnNumRecord: lastState.turnNum,
      finalizesAt: Math.floor(Date.now() / 1000),
      state: lastState,
      outcome: lastState.outcome,
    })
  }, [states])

  return (
    <>
      <Head>
        <title>OpenWare StateChannels POC</title>
        <link rel="icon" href="/favicon.ico" />
      </Head>
      <main>
        <h1>OpenWare StateChannels POC</h1>

        <div>
          <h2>Wallet</h2>
          <p>{account ? 'Connected with ' + account : 'Not connected'}</p>
          {!account && (
            <button
              type="button"
              onClick={() => activateWallet()}
              style={{ cursor: 'pointer' }}
            >
              Connect with Metamask
            </button>
          )}
          {account && balance && (
            <p>
              Balance: {formatEther(balance)}{' '}
              <button
                type="button"
                onClick={() => fetchBalance()}
                style={{ cursor: 'pointer' }}
              >
                Refresh
              </button>
            </p>
          )}
        </div>

        <div>
          <h2>Channel</h2>
          <p>Id: {channelId}</p>
          <pre>{JSON.stringify(channel, null, 4)}</pre>
          {channelStatus && (
            <pre>{JSON.stringify(parseStatus(channelStatus), null, 4)}</pre>
          )}
          <p>
            The channel currently holds: {formatUnits(channelHoldings || '0')}{' '}
            <button
              type="button"
              onClick={() => fetchChannelHoldings()}
              style={{ cursor: 'pointer' }}
            >
              Refresh
            </button>
          </p>
          <p>
            The state mode is {channelMode || 'unknown'}{' '}
            <button
              type="button"
              onClick={() => fetchChannelMode()}
              style={{ cursor: 'pointer' }}
            >
              Refresh
            </button>
          </p>
          <p>
            <button
              type="button"
              onClick={() => addNewParticipant(signer)}
              style={{ cursor: 'pointer' }}
            >
              Add a new participant
            </button>{' '}
            <button
              type="button"
              onClick={() => setChannelNonce(channelNonce + 1)}
              style={{ cursor: 'pointer' }}
            >
              Increase nonce
            </button>{' '}
            <button
              type="button"
              onClick={() => dispatchStates({ type: 'init', channel })}
              style={{ cursor: 'pointer' }}
            >
              Init first state
            </button>{' '}
            <button
              type="button"
              onClick={async () => {
                await withdrawAllAssets(signer, channelId)
                fetchChannelHoldings()
                fetchBalance()
              }}
              style={{ cursor: 'pointer' }}
            >
              Withdraw All
            </button>{' '}
          </p>
        </div>

        <div>
          <h2>States</h2>
          <pre>{JSON.stringify(states, null, 4)}</pre>

          {states.length > 0 &&
            channel.wallets.map((wallet, index) => {
              const turnNum = states[states.length - 1].turnNum
              const moverIndex = turnNum % channel.accounts.length
              const isSignerCurrentUser = account === channel.accounts[index]
              const canPlay = moverIndex !== index // can play if it's not the last to have played
              const participant = channel.accounts[index]
              return (
                <p key={wallet.address}>
                  Action for participant {participant}:{' '}
                  <button
                    type="button"
                    disabled={!isSignerCurrentUser && !canPlay}
                    onClick={async () => {
                      const amountString = window.prompt(
                        'How many ETH to deposit?',
                        '1',
                      )
                      if (!amountString) return
                      const amount = parseUnits(amountString, 'ether')
                      await deposit(signer, channelId, channelHoldings, amount)
                      fetchChannelHoldings()
                      fetchBalance()
                    }}
                    style={{ cursor: 'pointer' }}
                  >
                    Deposit
                  </button>{' '}
                  <button
                    type="button"
                    onClick={() => {
                      const amountString = window.prompt(
                        'How many ETH to transfer?',
                        '1',
                      )
                      if (!amountString) return
                      const amount = parseUnits(amountString, 'ether')
                      transferToOther(participant, amount)
                    }}
                    style={{ cursor: 'pointer' }}
                  >
                    Transfer to other
                  </button>{' '}
                  <button
                    type="button"
                    disabled={canPlay}
                    onClick={() => {
                      dispatchStates({
                        type: 'signLastState',
                        walletIndex: index,
                        wallet: wallet,
                      })
                    }}
                    style={{ cursor: 'pointer' }}
                  >
                    Sign state
                  </button>{' '}
                  <button
                    type="button"
                    disabled={!isSignerCurrentUser}
                    onClick={() => {
                      dispatchStates({
                        type: 'signLastState',
                        walletIndex: index,
                        wallet: wallet,
                      }) // FIXME: may need to add a delay
                      void conclude(signer)
                    }}
                    style={{ cursor: 'pointer' }}
                  >
                    Sign & Conclude
                  </button>{' '}
                  <button
                    type="button"
                    disabled={!isSignerCurrentUser}
                    onClick={() => {
                      void challenge(wallet, signer)
                    }}
                    style={{ cursor: 'pointer' }}
                  >
                    Challenge
                  </button>{' '}
                </p>
              )
            })}

          {states.length > 0 && (
            <p>
              <button
                type="button"
                onClick={() => dispatchStates({ type: 'copyLastState' })}
                style={{ cursor: 'pointer' }}
              >
                Copy last state
              </button>{' '}
              <button
                type="button"
                onClick={() => dispatchStates({ type: 'finalize' })}
                style={{ cursor: 'pointer' }}
              >
                Finalize
              </button>{' '}
            </p>
          )}
        </div>
        <br />
        <br />
        <br />
        <br />
      </main>
    </>
  )
}
