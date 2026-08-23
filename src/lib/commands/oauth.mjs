import { logger } from '../logger';
import { request } from '../request';

export async function runOAuthStatus(options) {
  const data = await request('GET', '/api/oauth/status');

  const connections = (data.providers ?? data.items ?? data).filter(
    (c) => c.authType === 'oauth' || c.authType === 'oauth2'
  );

  if (options.output === 'table') {
    if (connections.length === 0) {
      logger.info('No OAuth connections found.');
      return;
    }
    const table = connections.map(c => ({
      'Provider': c.provider,
      'Auth Type': c.authType,
      'Status': c.status,
      'Expires In': c.expiresIn ? `${c.expiresIn}s` : 'N/A'
    }));
    console.table(table);
  } else {
    console.log(JSON.stringify(connections, null, 2));
  }
}
