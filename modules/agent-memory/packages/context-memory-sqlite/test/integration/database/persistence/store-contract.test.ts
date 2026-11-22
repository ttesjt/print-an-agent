import { borrowed } from '../../../support/fixtures.js';

import { memoryStoreContract } from '../../../support/store-contract.js';

memoryStoreContract('SQLite', () => borrowed().store);
