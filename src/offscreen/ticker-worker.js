/**
 * 离屏文档 · 统一闹钟的节拍器(2026-11-01)
 *
 * 为什么单独开一个 Worker:
 *   Chrome 对「隐藏的页面 / 标签页」有定时器节流 —— 后台标签 1 秒一拍,
 *   隐藏超过 5 分钟且不出声的再压到 1 分钟一拍。这就是「切到别的标签页
 *   自动循环就停」的根因(用户 2026-11-01 明确反馈)。
 *
 *   Worker 有独立的执行上下文,**不参与页面可见性节流**,所以把节拍器放这里。
 *   主线程(ticker.js)只负责把节拍转发给中控台标签。
 *
 * 协议:主线程 postMessage('start') → 开始;此后每秒 postMessage(Date.now())。
 */
self.onmessage = function (e) {
  if (e.data !== 'start') return;

  // 重复 start 不叠加:一个 Worker 实例只跑一条计时链。
  if (self.__dycBeatTimer) return;
  self.__dycBeatTimer = setInterval(function () {
    self.postMessage(Date.now());
  }, 1000);
};
