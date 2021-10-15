import { BigNumber } from '@ethersproject/bignumber'
import { JsonRpcProvider } from '@ethersproject/providers'
import { useWeb3React } from '@web3-react/core'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { injectedConnector } from '../lib/connector'

export default function useWallet() {
  const {
    account,
    activate,
    error: web3Error,
    library,
    chainId,
  } = useWeb3React<JsonRpcProvider>()

  useEffect(() => {
    void injectedConnector.isAuthorized().then((isAuthorized) => {
      if (!isAuthorized) return
      void activate(injectedConnector, undefined, false).catch()
    })
  }, [activate]) // intentionally only running on mount (make sure it's only mounted once :))

  const signer = useMemo(() => {
    if (!library) return
    if (!account) return
    return library.getSigner(account)
  }, [library, account])

  useEffect(() => {
    if (web3Error) throw web3Error
  }, [web3Error])

  const [balance, setBalance] = useState<BigNumber>()

  const fetchBalance = useCallback(() => {
    if (!library) return
    if (!account) return
    void library.getBalance(account).then(setBalance)
  }, [account, library])
  useEffect(() => fetchBalance(), [fetchBalance])

  const activateWallet = useCallback(() => {
    return activate(injectedConnector, undefined, true)
  }, [activate])

  return {
    account,
    chainId,
    signer,
    balance,
    fetchBalance,
    activateWallet,
  }
}
