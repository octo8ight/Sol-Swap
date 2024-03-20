import { ZERO } from '@jup-ag/math';
import { QuoteResponse, SwapMode, TransactionFeeInfo, calculateFeeForSwap } from '@jup-ag/react-hook';
import { TokenInfo } from '@solana/spl-token-registry';
import classNames from 'classnames';
import Decimal from 'decimal.js';
import JSBI from 'jsbi';
import React, { useEffect, useMemo, useState } from 'react';
import { useSwapContext } from 'src/contexts/SwapContext';
import { useWalletPassThrough } from 'src/contexts/WalletPassthroughProvider';
import { formatNumber } from 'src/misc/utils';
import ExchangeRate from '../ExchangeRate';
import Deposits from './Deposits';
import Fees from './Fees';
import TransactionFee from './TransactionFee';
import { useAccounts } from 'src/contexts/accounts';
import PlatformFees, { PlatformFeesInfo } from './PlatformFees';

const Index = ({
  quoteResponse,
  fromTokenInfo,
  toTokenInfo,
  loading,
  showFullDetails = false,
  containerClassName,
}: {
  quoteResponse: QuoteResponse;
  fromTokenInfo: TokenInfo;
  toTokenInfo: TokenInfo;
  loading: boolean;
  showFullDetails?: boolean;
  containerClassName?: string;
}) => {
  const rateParams = {
    inAmount: quoteResponse?.inAmount || ZERO, // If there's no selectedRoute, we will use first route value to temporarily calculate
    inputDecimal: fromTokenInfo.decimals,
    outAmount: quoteResponse?.outAmount || ZERO, // If there's no selectedRoute, we will use first route value to temporarily calculate
    outputDecimal: toTokenInfo.decimals,
  };

  const { accounts } = useAccounts();

  const { wallet } = useWalletPassThrough();
  const walletPublicKey = useMemo(() => wallet?.adapter.publicKey?.toString(), [wallet?.adapter.publicKey]);

  const priceImpact = formatNumber.format(new Decimal(quoteResponse?.priceImpactPct || 0).mul(100).toDP(4).toNumber());
  const priceImpactText = Number(priceImpact) < 0.1 ? `< ${formatNumber.format(0.1)}%` : `~ ${priceImpact}%`;

  const otherAmountThresholdText = useMemo(() => {
    if (quoteResponse?.otherAmountThreshold) {
      const amount = new Decimal(quoteResponse.otherAmountThreshold.toString()).div(Math.pow(10, toTokenInfo.decimals));

      const amountText = formatNumber.format(amount.toNumber());
      return `${amountText} ${toTokenInfo.symbol}`;
    }
    return '-';
  }, [quoteResponse]);

  const [feeInformation, setFeeInformation] = useState<TransactionFeeInfo>();

  const mintToAccountMap = useMemo(() => {
    return new Map(Object.entries(accounts).map((acc) => [acc[0], acc[1].pubkey.toString()]));
  }, [accounts]);

  useEffect(() => {
    if (quoteResponse) {
      const fee = calculateFeeForSwap(
        quoteResponse,
        mintToAccountMap,
        new Map(), // we can ignore this as we are using shared accounts
        true,
        true,
      );
      setFeeInformation(fee);
    } else {
      setFeeInformation(undefined);
    }
  }, [quoteResponse, walletPublicKey, mintToAccountMap]);

  const hasAtaDeposit = (feeInformation?.ataDeposits.length ?? 0) > 0;
  const hasSerumDeposit = (feeInformation?.openOrdersDeposits.length ?? 0) > 0;

  const {
    jupiter: { priorityFeeInSOL },
  } = useSwapContext();

  return (
    <div className={classNames('mt-4 space-y-4 border border-white/5 rounded-xl p-3', containerClassName)}>
      <div className="flex items-center justify-between text-xs">
        <div className="text-white/30">{<span>Rate</span>}</div>
        {JSBI.greaterThan(rateParams.inAmount, ZERO) && JSBI.greaterThan(rateParams.outAmount, ZERO) ? (
          <ExchangeRate
            loading={loading}
            rateParams={rateParams}
            fromTokenInfo={fromTokenInfo}
            toTokenInfo={toTokenInfo}
            reversible={true}
          />
        ) : (
          <span className="text-white/30">{'-'}</span>
        )}
      </div>

      <div className="flex items-center justify-between text-xs text-white/30">
        <div>
          <span>Price Impact</span>
        </div>
        <div>{priceImpactText}</div>
      </div>

      <div className="flex items-center justify-between text-xs">
        <div className="text-white/30">
          {quoteResponse?.swapMode === SwapMode.ExactIn ? <span>Minimum Received</span> : <span>Maximum Consumed</span>}
        </div>
        <div className="text-white/30">{otherAmountThresholdText}</div>
      </div>

      {showFullDetails ? (
        <>
          <Fees routePlan={quoteResponse?.routePlan} swapMode={quoteResponse.swapMode as SwapMode} />
          <TransactionFee feeInformation={feeInformation} />
          <Deposits hasSerumDeposit={hasSerumDeposit} hasAtaDeposit={hasAtaDeposit} feeInformation={feeInformation} />
          {(quoteResponse as QuoteResponse & PlatformFeesInfo).platformFee ? (
            <PlatformFees
              platformFee={(quoteResponse as QuoteResponse & PlatformFeesInfo).platformFee}
              tokenInfo={quoteResponse?.swapMode === SwapMode.ExactIn ? toTokenInfo : fromTokenInfo}
            />
          ) : null}

          {priorityFeeInSOL > 0 ? (
            <div className="flex items-center justify-between text-xs">
              <div className="text-white/30">Priority Fee</div>
              <div className="text-white/30">{new Decimal(priorityFeeInSOL).toString()}</div>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
};

export default Index;
