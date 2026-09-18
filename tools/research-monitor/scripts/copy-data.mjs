import {mkdir,copyFile} from 'node:fs/promises';
await mkdir('dist/data',{recursive:true});
await copyFile('data/papers.json','dist/data/papers.json');
