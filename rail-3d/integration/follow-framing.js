const smooth=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};

// 只移動相機在本車線形上的注視點；車輛座標、里程與編組完全不變。
export function headFramingDistance(model,{zoom,pitch,bearing,angle,latitude,width,height,padding}){
  if(!model||!model.parts.length||zoom<14)return 0;
  const relative=(90-angle*180/Math.PI-bearing)*Math.PI/180;
  const signedSide=Math.sin(relative),side=Math.abs(signedSide),along=Math.cos(relative),tilt=pitch*Math.PI/180;
  const first=model.parts[0],front=first.offsetM+first.lengthM/2;
  const metresPerPixel=2*Math.PI*6378137*Math.cos(latitude*Math.PI/180)/(512*2**zoom);
  const w=Math.max(64,width-padding.left-padding.right-40),h=Math.max(64,height-padding.top-padding.bottom-40);
  // 朝向鏡頭的前段會被透視放大。把前方空間換回地面公尺時一併扣除這個量，
  // 不能只用 cos(pitch) 的平行投影，也不能以「側看程度」關掉正面與俯視構圖。
  const perspective=Math.max(0,-along)*Math.sin(tilt)/(height*1.5);
  const ahead=Math.min(w*.20*metresPerPixel/Math.max(.05,side+w*.20*perspective),h*.20*metresPerPixel/Math.max(.05,Math.abs(along)*Math.cos(tilt)+h*.20*perspective));
  let distance=Math.min(first.offsetM,Math.max(0,front-ahead));
  // 手機跟車卡的 padding 可能讓注視點靠邊；以真實畫面邊界保護第一節車廂。
  if(side>.25){
    const origin=(width+padding.left-padding.right)/2,half=(first.lengthM*side+model.widthM*Math.abs(along))/(2*metresPerPixel);
    const correction=(offset,margin)=>{const x=origin+(offset-distance)*signedSide/metresPerPixel,target=Math.max(margin,Math.min(width-margin,x));return (x-target)*metresPerPixel/signedSide;};
    const whole=smooth(8,40,width-half*2);
    distance+=whole*correction(first.offsetM,Math.min(width/2,half+28))+(1-whole)*correction(front,24);
  }
  return Math.max(0,Math.min(front,distance))*smooth(14,15,zoom);
}

// 當車頭橫向寬度已塞不進左下小卡旁，平順地把注視區改到小卡上方。
export function headFramingPadding(model,{zoom,bearing,angle,latitude,width,height,padding},panelTop,controlsBottom=0){
  if(!model||panelTop==null)return padding;
  const a=(90-angle*180/Math.PI-bearing)*Math.PI/180,mpp=2*Math.PI*6378137*Math.cos(latitude*Math.PI/180)/(512*2**zoom);
  const footprint=(model.parts[0].lengthM*Math.abs(Math.sin(a))+model.widthM*Math.abs(Math.cos(a)))/mpp;
  const available=Math.max(64,width-padding.left-padding.right),t=smooth(available*.65,available*1.1,footprint);
  return {...padding,top:padding.top+(Math.max(padding.top,controlsBottom)-padding.top)*t,left:padding.left*(1-t),right:padding.right*(1-t),bottom:padding.bottom+(Math.max(padding.bottom,height-panelTop+20)-padding.bottom)*t};
}
