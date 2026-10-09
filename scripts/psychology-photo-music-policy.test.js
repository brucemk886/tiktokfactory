import test from 'node:test';
import assert from 'node:assert/strict';
import {drawPhotoMusic,normalizePhotoMusicIds} from './psychology-photo-music-policy.js';
import {PHOTO_MUSIC_LIBRARY} from '../public/psychology-photo-music-library.js';
test('approved eight are exact string IDs and random boundaries never leave the chosen subset',()=>{
 assert.deepEqual(PHOTO_MUSIC_LIBRARY.map(t=>t.id),['6873559269682186241','7592390338558511121','7190464410404521985','6873874427382073346','6954431177495152641','7619819911367559184','6817312345782503425','7076030445804062722']);
 const selected=PHOTO_MUSIC_LIBRARY.filter((_,i)=>i===1||i===5).map(t=>t.id);
 assert.equal(drawPhotoMusic([],()=>assert.fail('empty pool must not draw')),'');
 assert.equal(drawPhotoMusic(selected,()=>0),selected[0]);assert.equal(drawPhotoMusic(selected,()=>0.999999),selected[1]);
 for(let i=0;i<100;i++)assert.ok(selected.includes(drawPhotoMusic(selected)));
 assert.deepEqual(normalizePhotoMusicIds([selected[0],selected[0]]),[selected[0]]);
 assert.throws(()=>normalizePhotoMusicIds([Number(selected[0])]),/音乐 ID/);
});
