import {gunzipSync,unzlibSync} from 'fflate';
export type Nbt=Record<string,any>;
export function readNbt(input:Uint8Array):Nbt {
  const bytes=input[0]===31&&input[1]===139?gunzipSync(input):input;
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),decoder=new TextDecoder();let p=0,count=0;
  const take=(n:number)=>{if(n<0||p+n>bytes.length)throw new Error('NBTデータが途中で切れています');const start=p;p+=n;return start;};
  const u8=()=>view.getUint8(take(1)),i32=()=>view.getInt32(take(4)),str=()=>{const n=view.getUint16(take(2));return decoder.decode(bytes.subarray(take(n),p));};
  const arrayLength=()=>{const n=i32();if(n<0||n>16_777_216)throw new Error('NBT配列の長さが不正です');return n;};
  function value(type:number,depth:number):any {
    if(depth>64||++count>16_777_216)throw new Error('NBTの構造が大きすぎます');
    switch(type){
      case 1:return view.getInt8(take(1));case 2:return view.getInt16(take(2));case 3:return i32();case 4:return view.getBigInt64(take(8));
      case 5:return view.getFloat32(take(4));case 6:return view.getFloat64(take(8));
      case 7:{const n=arrayLength();return bytes.slice(take(n),p);}case 8:return str();
      case 9:{const child=u8(),n=arrayLength();if(child===0&&n)throw new Error('Invalid NBT list');return Array.from({length:n},()=>value(child,depth+1));}
      case 10:{const result:Nbt=Object.create(null);for(let t=u8();t;t=u8()){const name=str();result[name]=value(t,depth+1);}return result;}
      case 11:return Int32Array.from({length:arrayLength()},i32);
      case 12:return Array.from({length:arrayLength()},()=>view.getBigInt64(take(8)));
      default:throw new Error(`未対応のNBTタグ: ${type}`);
    }
  }
  const type=u8();if(type!==10)throw new Error('Java版のNBTデータではありません');str();return value(type,0);
}
export function unpackStates(data:bigint[],length:number,padded:boolean,count=4096,minBits=4):Uint16Array {
  const output=new Uint16Array(count);if(length===1)return output;
  const bits=Math.max(minBits,Math.ceil(Math.log2(length))),mask=(1n<<BigInt(bits))-1n,perWord=Math.floor(64/bits);
  if(data.length<(padded?Math.ceil(count/perWord):Math.ceil(count*bits/64)))throw new Error('ブロックの状態配列が途中で切れています');
  for(let i=0;i<count;i++){const word=padded?Math.floor(i/perWord):Math.floor(i*bits/64),shift=padded?i%perWord*bits:i*bits%64;
    let v=BigInt.asUintN(64,data[word])>>BigInt(shift);if(!padded&&shift+bits>64)v|=BigInt.asUintN(64,data[word+1])<<BigInt(64-shift);
    output[i]=Number(v&mask);if(output[i]>=length)throw new Error('不正なブロックパレット');}
  return output;
}
export function* regionChunks(bytes:Uint8Array,name:string){
  if(bytes.length<8192)throw new Error(`リージョンファイルが途中で切れています: ${name}`);
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  for(let i=0;i<1024;i++){const offset=(bytes[i*4]*65536+bytes[i*4+1]*256+bytes[i*4+2])*4096;if(!offset)continue;
    if(offset+5>bytes.length)throw new Error(`不正なリージョン: ${name}`);
    const length=view.getUint32(offset),type=bytes[offset+4];if(length<1||offset+4+length>bytes.length)throw new Error(`不正なチャンク長: ${name}`);
    const data=bytes.subarray(offset+5,offset+4+length);
    if(type&128)throw new Error('外部 .mcc チャンクはまだ対応していません');
    const raw=type===1?gunzipSync(data):type===2?unzlibSync(data):type===3?data:null;
    if(!raw)throw new Error(`チャンク圧縮形式 ${type} は未対応です`);
    yield readNbt(raw);
  }
}
