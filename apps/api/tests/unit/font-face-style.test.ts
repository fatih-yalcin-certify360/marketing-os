import { expect, it } from 'vitest';
import { fontFaceStyle } from '../../src/integrations/brand-portal/font-names.js';
it('reads face weight and italic flag without following invalid offsets',()=>{
 const bytes=Buffer.alloc(100);bytes.writeUInt32BE(0x00010000,0);bytes.writeUInt16BE(1,4);bytes.write('OS/2',12);bytes.writeUInt32BE(28,20);bytes.writeUInt32BE(64,24);bytes.writeUInt16BE(700,32);bytes.writeUInt16BE(1,90);
 expect(fontFaceStyle(bytes)).toEqual({weight:700,style:'italic'});
 bytes.writeUInt32BE(10000,20);expect(fontFaceStyle(bytes)).toEqual({weight:400,style:'normal'});
});
