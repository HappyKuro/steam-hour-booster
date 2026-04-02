'use strict';

const { main } = require('./src/cli');

main().catch((error) => {
    const details = error?.stack || error?.message || String(error);
    console.error(details);
    process.exit(1);
});
