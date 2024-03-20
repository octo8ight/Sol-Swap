import { useQuery } from '@tanstack/react-query';
import { createContext, FC, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useDebounce, useLocalStorage } from 'react-use';
import { splitIntoChunks } from 'src/misc/utils';
import { useAccounts } from './accounts';
import { useTokenContext } from './TokenContextProvider';
import { useSwapContext } from './SwapContext';

const MAXIMUM_PARAM_SUPPORT = 100;
const CACHE_EXPIRE_TIME = 1000 * 60 * 1; // 1 min
const STORAGE_KEY = 'jupiter-terminal-cached-token-prices';

interface CacheUSDValue {
  usd: number;
  timestamp: number;
}

export interface ITokenUSDValue {
  [key: string]: CacheUSDValue | undefined;
}

export interface USDValueState {
  tokenPriceMap: ITokenUSDValue;
}

export const USDValueProviderContext = createContext<USDValueState>({} as USDValueState);

export function useUSDValueProvider(): USDValueState {
  return useContext(USDValueProviderContext);
}

interface JupPriceResponse {
  [id: string]: { id: string; mintSymbol: string; vsToken: string; vsTokenSymbol: string; price: number };
}

const hasExpired = (timestamp: number) => {
  if (new Date().getTime() - timestamp >= CACHE_EXPIRE_TIME) {
    return true;
  }

  return false;
};

export const USDValueProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const { accounts } = useAccounts();
  const { tokenMap } = useTokenContext();
  const { fromTokenInfo, toTokenInfo,
  } = useSwapContext();

  const [cachedPrices, setCachedPrices] = useLocalStorage<ITokenUSDValue>(STORAGE_KEY, {});
  const [addresses, setAddresses] = useState<Set<string>>(new Set());
  const [debouncedAddresses, setDebouncedAddresses] = useState<string[]>([]);

  useDebounce(
    () => {
      setDebouncedAddresses(Array.from(addresses));
    },
    250,
    [addresses],
  );

  const getPriceFromJupAPI = useCallback(async (addresses: string[]) => {
    const { data }: { data: JupPriceResponse } = await fetch(
      `https://price.jup.ag/v4/price?ids=${addresses.join(',')}`,
    ).then((res) => res.json());

    const nowTimestamp = new Date().getTime();
    const result = addresses.reduce<{ result: Record<string, CacheUSDValue>; failed: string[] }>(
      (accValue, address, idx) => {
        const priceForAddress = data[address];
        if (!priceForAddress) {
          return {
            ...accValue,
            failed: [...accValue.failed, addresses[idx]],
          };
        }

        return {
          ...accValue,
          result: {
            ...accValue.result,
            [priceForAddress.id]: {
              usd: priceForAddress.price,
              timestamp: nowTimestamp,
            },
          },
        };
      },
      { result: {}, failed: [] },
    );

    return result;
  }, []);

  const { data: tokenPriceMap, isFetched: isLatest } = useQuery<ITokenUSDValue>(
    [debouncedAddresses, Object.keys(cachedPrices || {}).length],
    async () => {
      let results: ITokenUSDValue = {};
      const tokenAddressToFetch: string[] = [];

      debouncedAddresses.forEach((address) => {
        // could be empty string
        if (address) {
          const cachePrice = (cachedPrices || {})[address];

          if (!cachePrice) {
            tokenAddressToFetch.push(address);
            return;
          }

          if (hasExpired(cachePrice.timestamp)) {
            tokenAddressToFetch.push(address);
            return;
          }

          results = {
            ...results,
            [address]: {
              usd: cachePrice.usd,
              timestamp: cachePrice.timestamp,
            },
          };
        }
      });

      if (!tokenAddressToFetch.length) return results;

      try {
        // Fetch from JUP
        const fetchFromJup = splitIntoChunks(tokenAddressToFetch, MAXIMUM_PARAM_SUPPORT);

        const allResults = await Promise.all(
          fetchFromJup.map(async (batch) => {
            return await getPriceFromJupAPI(batch);
          }),
        );
        allResults.forEach(({ result }) => {
          results = {
            ...results,
            ...result,
          };
        });
      } catch (error) {
        console.log('Error fetching prices from Jupiter Pricing API', error);
      }
      return results;
    },
    {
      staleTime: CACHE_EXPIRE_TIME,
      refetchInterval: CACHE_EXPIRE_TIME,
    },
  );

  // Clear the expired cache on first load
  useEffect(() => {
    setCachedPrices((prevState) =>
      Object.entries(prevState || {})
        .filter(([mint, usdCacheValue]) => !hasExpired(usdCacheValue?.timestamp ?? 0))
        .reduce(
          (accValue, [mint, usdCacheValue]) => ({
            ...accValue,
            [mint]: usdCacheValue,
          }),
          {},
        ),
    );
  }, []);

  useEffect(() => {
    if (!Object.keys(accounts).length || !tokenMap.size) return;

    const userAccountAddresses: string[] = Object.keys(accounts)
      .map((key) => {
        const token = tokenMap.get(key);

        if (!token) return undefined;

        return token.address;
      })
      .filter(Boolean) as string[];

    setAddresses((prev) => {
      return new Set([...prev, ...userAccountAddresses]);
    });
  }, [accounts, tokenMap]);

  // Make sure form token always have USD values
  useEffect(() => {
    setAddresses((prev) => {
      const newSet = new Set([...prev]);
      if (fromTokenInfo?.address) newSet.add(fromTokenInfo?.address);
      if (toTokenInfo?.address) newSet.add(toTokenInfo?.address);
      return newSet
    });
  }, [fromTokenInfo, toTokenInfo])

  // use memo so that it avoid a rerendering
  const priceMap = useMemo(() => {
    return {
      ...cachedPrices,
      ...tokenPriceMap,
    };
  }, [tokenPriceMap, cachedPrices]);

  return <USDValueProviderContext.Provider value={{ tokenPriceMap: priceMap }}>{children}</USDValueProviderContext.Provider>;
};
