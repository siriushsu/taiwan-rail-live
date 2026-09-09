const smooth=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};

// 只計算相機在本車線形上向車頭前移幾公尺，絕不改變任何車廂的位置。
export function headFramingDistance(model,{zoom,pitch,bearing,angle,latitude,width,height,padding}){
  // 低角度不能用側向投影估整列可見範圍：透視會把近端車頭推到畫面外。
  if(model?.parts?.length&&pitch>=60&&zoom>=14)return Math.max(0,model.parts[0].offsetM);
  if(!model||model.compact||model.mode!=='actual'||model.parts.length<4||zoom<14)return 0;
  const relative=(90-angle*180/Math.PI-bearing)*Math.PI/180,signedSide=Math.sin(relative),side=Math.abs(signedSide);
  const strength=smooth(12,42,pitch)*smooth(.25,.8,side)*smooth(14,15,zoom);
  if(!strength)return 0;
  const first=model.parts[0],front=first.offsetM+first.lengthM/2;
  const metresPerPixel=2*Math.PI*6378137*Math.cos(latitude*Math.PI/180)/(512*2**zoom);
  const w=Math.max(64,width-padding.left-padding.right-40),h=Math.max(64,height-padding.top-padding.bottom-40);
  // 保留前方空間；側面以寬度為主，斜側面同時考慮畫面高度。
  const ahead=Math.min(w*.24*metresPerPixel/Math.max(.05,side),h*.24*metresPerPixel/Math.max(.05,Math.abs(Math.cos(relative))*Math.cos(pitch*Math.PI/180)));
  let distance=Math.min(first.offsetM,Math.max(0,first.offsetM*.35,front-ahead))*strength;
  // 窄螢幕的跟車卡可能讓注視點偏右；最大縮放仍須保護車頭的實際畫面邊界。
  if(side>.25){
    const origin=(width+padding.left-padding.right)/2,half=(first.lengthM*side+model.widthM*Math.abs(Math.cos(relative)))/(2*metresPerPixel);
    const correction=(offset,margin)=>{const x=origin+(offset-distance)*signedSide/metresPerPixel,target=Math.max(margin,Math.min(width-margin,x));return (x-target)*metresPerPixel/signedSide;};
    const whole=smooth(8,40,width-half*2),delta=whole*correction(first.offsetM,Math.min(width/2,half+30))+(1-whole)*correction(front,32);
    distance+=delta*strength;
  }
  return Math.max(0,Math.min(front,distance));
}
