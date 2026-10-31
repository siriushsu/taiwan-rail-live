import {smooth} from './new-scene-kit.js';
// 微縮展示時序；在車頭到達道路前完成落桿，依整列尾端清空才開放。
export function crossingState(distance,length,pathLength,speed=2.6){
 const center=((distance+pathLength/2)%pathLength+pathLength)%pathLength-pathLength/2;
 const arrival=(center+length/2+3.5)/speed,clear=(center-length/2-3.5)/speed;
 let closed=0;if(arrival>=-4&&clear<=.8)closed=smooth((arrival+4)/2);else if(clear>.8&&clear<3)closed=1-smooth((clear-.8)/2.2);
 const alarm=arrival>=-6&&clear<3,occupied=arrival>=0&&clear<=0;
 return{center,arrival,clear,closed,alarm,occupied,phase:!alarm?'通行開放':arrival<-4?'列車接近':arrival<-2?'遮斷桿下降':clear<=.8?'等待列車通過':'遮斷桿上升'};
}
