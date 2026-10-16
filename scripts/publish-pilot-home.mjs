import {copyFileSync,mkdirSync} from 'node:fs';
// Package the reviewed public landing snapshot without querying production configuration.
// The existing fictional harness retains its generated /testing route.
mkdirSync('dist/testing',{recursive:true});
copyFileSync('dist/index.html','dist/testing/index.html');
copyFileSync('public/pilot/index.html','dist/index.html');
