import { Inject } from '@nestjs/common';
import { gql, GraphQLClient } from 'graphql-request';
import { sumBy } from 'lodash';

import { APP_TOOLKIT, IAppToolkit } from '~app-toolkit/app-toolkit.interface';
import { Register } from '~app-toolkit/decorators';
import { CacheOnInterval } from '~cache/cache-on-interval.decorator';
import { TvlFetcher } from '~stats/tvl/tvl-fetcher.interface';
import { Network } from '~types/network.interface';

import { SYNTHETIX_DEFINITION } from '../synthetix.definition';

type Holder = {
  id: string;
  collateral: string;
  transferable: string;
  initialDebtOwnership: string;
};

type HoldersResult = {
  snxholders: Holder[];
};

const HOLDERS_QUERY = gql`
  query getHolders($lastId: String!) {
    snxholders(
      first: 1000
      skip: $skip
      orderBy: collateral
      orderDirection: desc
      where: { initialDebtOwnership_not: "0", id_gt: $lastId }
    ) {
      id
      collateral
      transferable
      initialDebtOwnership
    }
  }
`;

const appId = SYNTHETIX_DEFINITION.id;
const network = Network.OPTIMISM_MAINNET;

@Register.TvlFetcher({ appId, network })
export class OptimismSynthetixTvlFetcher implements TvlFetcher {
  constructor(@Inject(APP_TOOLKIT) private readonly appToolkit: IAppToolkit) {}

  @CacheOnInterval({
    key: `studio:${SYNTHETIX_DEFINITION.id}:${Network.OPTIMISM_MAINNET}:snx-holders`,
    timeout: 15 * 60 * 1000,
  })
  private async cacheSynthetixHolders() {
    const client = new GraphQLClient('https://api.thegraph.com/subgraphs/name/synthetixio-team/optimism-main');
    const holders = new Map<string, Holder>();

    let lastResult: HoldersResult;
    let lastId = '';

    do {
      lastResult = await client.request<HoldersResult>(HOLDERS_QUERY, { lastId });
      lastId = lastResult.snxholders[lastResult.snxholders.length - 1].id;
      lastResult.snxholders.forEach(v => holders.set(v.id, v));
    } while (lastResult.snxholders.length === 1000);

    return Array.from(holders.values());
  }

  async getTvl() {
    // Total Locked SNX
    const baseTokens = await this.appToolkit.getBaseTokenPrices(network);
    const snxToken = baseTokens.find(v => v.symbol === 'SNX')!;
    const cacheKey = `studio:${SYNTHETIX_DEFINITION.id}:${Network.OPTIMISM_MAINNET}:snx-holders`;
    const holders = (await this.appToolkit.getFromCache<Holder[]>(cacheKey)) ?? [];
    const totalSNXLockedUSD = sumBy(holders, v => (Number(v.collateral) - Number(v.transferable)) * snxToken.price);

    return totalSNXLockedUSD;
  }
}
