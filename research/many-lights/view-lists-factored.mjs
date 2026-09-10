/**
 * Exact factoring of axis-aligned tile frusta: test each light against column,
 * row and depth planes once, then form the same Cartesian product of survivors.
 * The two-pass CSR fill retains source order without per-candidate allocation.
 */
export const buildViewListsFactored = (lights, viewProjection, {
  columns = 16, rows = 16, byteBudget = 1024 * 1024,
} = {}) => {
  if (!Number.isSafeInteger(columns) || columns < 1 || !Number.isSafeInteger(rows) || rows < 1
    || !Number.isSafeInteger(byteBudget) || byteBudget < 0
    || viewProjection.length !== 16 || !Array.from(viewProjection).every(Number.isFinite)) throw new Error('Invalid tile-list input');
  const tileCount=columns*rows, headers=tileCount*2, availableWords=Math.floor(byteBudget/4);
  if (!Number.isSafeInteger(tileCount) || headers>availableWords) return {kind:'global',reason:'budget'};
  const storage=new Uint32Array(Math.min(availableWords,headers+tileCount*lights.length));
  const axisCount=columns+rows, depthOffset=axisCount*10;
  const planes=new Float64Array(depthOffset+10), masks=new Uint8Array(axisCount*lights.length);
  const write=(offset,row,sign,scale)=>{
    for(let c=0;c<4;c++)planes[offset+c]=sign*viewProjection[row+c*4]+scale*viewProjection[3+c*4];
    planes[offset+4]=Math.hypot(planes[offset],planes[offset+1],planes[offset+2]);
  };
  for(let x=0;x<columns;x++){write(x*10,0,1,-(2*x/columns-1));write(x*10+5,0,-1,2*(x+1)/columns-1);}
  for(let y=0;y<rows;y++){write((columns+y)*10,1,1,-(2*y/rows-1));write((columns+y)*10+5,1,-1,2*(y+1)/rows-1);}
  for(let c=0;c<4;c++){
    planes[depthOffset+c]=viewProjection[3+c*4]+viewProjection[2+c*4];
    planes[depthOffset+5+c]=viewProjection[3+c*4]-viewProjection[2+c*4];
  }
  planes[depthOffset+4]=Math.hypot(planes[depthOffset],planes[depthOffset+1],planes[depthOffset+2]);
  planes[depthOffset+9]=Math.hypot(planes[depthOffset+5],planes[depthOffset+6],planes[depthOffset+7]);
  const passes=(offset,px,py,pz,radius)=>{
    for(let p=offset;p<offset+10;p+=5){
      const distance=planes[p]*px+planes[p+1]*py+planes[p+2]*pz+planes[p+3],reach=radius*planes[p+4];
      if(distance < -reach-1e-6*(Math.abs(distance)+reach+1))return false;
    }
    return true;
  };
  let references=0;
  for(let index=0;index<lights.length;index++){
    const light=lights[index],radius=light.range,base=index*axisCount;
    if(light.kind==='directional'||!(radius>0))masks.fill(1,base,base+axisCount);
    else{
      const [px,py,pz]=light.position;
      if(!passes(depthOffset,px,py,pz,radius))continue;
      for(let axis=0;axis<axisCount;axis++)masks[base+axis]=passes(axis*10,px,py,pz,radius)?1:0;
    }
    for(let y=0;y<rows;y++)if(masks[base+columns+y])for(let x=0;x<columns;x++)if(masks[base+x]){
      if(headers+references===storage.length)return {kind:'global',reason:'budget'};
      storage[(y*columns+x)*2+1]++;references++;
    }
  }
  const cursors=new Uint32Array(tileCount);let cursor=headers,maxCount=0;
  for(let tile=0;tile<tileCount;tile++){
    const count=storage[tile*2+1];storage[tile*2]=cursor;cursors[tile]=cursor;cursor+=count;maxCount=Math.max(maxCount,count);
  }
  for(let index=0;index<lights.length;index++){
    const base=index*axisCount;
    for(let y=0;y<rows;y++)if(masks[base+columns+y])for(let x=0;x<columns;x++)if(masks[base+x])storage[cursors[y*columns+x]++]=index;
  }
  return {kind:'tiled',columns,rows,words:storage.subarray(0,cursor),maxCount,
    meanCount:references/tileCount,allocatedBytes:storage.byteLength,uploadBytes:cursor*4};
};
