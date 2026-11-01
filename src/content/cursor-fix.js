/**
 * 抓手光标可见性修复
 *
 * 【背景 · 用户 2026-10-11 提出】
 *   在巨量百应 / 抖店中控台的商品列表里,鼠标进入可拖拽排序区域时
 *   会变成「抓手」光标。Chromium 内置的 grab 光标只有白色填充、没有描边,
 *   叠在浅色 / 白色商品列表上就与背景糊成一片,用户形容为
 *   「纯白色,根本看不到鼠标了」。
 *
 * 【为什么扩展能修】
 *   网页无法给**内置**光标上色 —— CSS cursor 走关键字时一律取浏览器/系统内置
 *   资源,没有「带描边的手」这个关键字可用。
 *   但 cursor 支持**自定义图片**:cursor: url(图) 热点x 热点y, 兜底关键字。
 *   于是自绘一张「白色填充 + 近黑描边」的抓手图内联进来,既保住手型语义,
 *   又保证在浅色 / 白色商品列表上看得见。
 *
 * 【历史:为什么不再用 move】
 *   上一版为「至少看得见」退而求其次选了 move(四向箭头),它在视觉上就是
 *   一个十字架,与用户原意(手型)不符。move 只是权宜之计,现已被自定义图取代。
 *   自定义图加载失败时,兜底关键字仍用 move(而非 grab)——
 *   因为 grab 正是我们要修的那个「看不见的白手」,不能让它当兜底。
 *
 * 【坑:data: 光标受页面 CSP 约束,且失败是静默的】
 *   data: 形式的图片走 img-src 检查。若平台 CSP 未放行 data:,
 *   浏览器会**悄悄丢掉**整张图并落到兜底关键字 —— 控制台不一定报错,
 *   表现为「改了却没生效」。因此这里加了 CSP 探针(见 probeCursorImage),
 *   实测失败就主动退回 move,并打印警告,不留下静默降级。
 *
 * 【难点:怎么找全「哪些元素是抓手」】
 *   平台是 React + 微前端,拖拽区既可能由样式表规则控制,也可能被 JS 动态
 *   改 class / 内联 style,还有 :hover 这种只在悬停瞬间才生效的写法。
 *   更麻烦的是**平台的 CSS 大概率跨域**(CDN 加载),此时
 *   document.styleSheets[i].cssRules 会抛 SecurityError,读不到规则。
 *
 *   因此用三条互补路径,任一条命中即可生效:
 *     路径 A(静态规则)  遍历 CSSOM,读出 cursor:grab 的选择器**原样**翻译成
 *                        带 !important 的覆盖规则。同域时开销为 0 且能覆盖
 *                        :hover 规则;跨域表读不到,交给 B、C。
 *     路径 B(悬停实测)  mouseover / mousedown 时元素**正处于悬停态**,
 *                        此刻 getComputedStyle 返回的正是真实光标 —— 于是
 *                        :hover 规则与跨域表都能被准确识别。命中即打标记。
 *     路径 C(DOM 兜底)  开局分片扫描 + MutationObserver 增量扫描,处理内联
 *                        style="cursor:grab" 这类 CSSOM 够不到的情况。
 *
 *   三条路径最终都汇到同一个出口:给元素打上属性标记
 *   data-dyc-cursor-fix,由一条属性选择器规则统一接管光标。
 *
 * 【默认开启】与其它功能开关口径一致(见 flags.js 注释)。
 */

(function cursorVisibilityFix() {
  'use strict';

  // 防止重复注入(SPA 路由切换等场景)
  if (window.__DYC_CURSOR_FIX__) return;
  window.__DYC_CURSOR_FIX__ = true;

  var STYLE_ID = 'dyc-cursor-fix-style';

  /**
   * 自绘抓手光标(内联 data URI PNG)—— 一对两态、每态两张分辨率。
   *
   *   CURSOR_PNG           悬停态 1x(32px):手是张开的(抓握形),表示「这里可以拖」
   *   CURSOR_PNG_2X        悬停态 2x(64px):同一形状的高分辨率版本
   *   CURSOR_PNG_ACTIVE    按下态 1x(32px):手蜷成拳(握拳形),表示「正在拖」
   *   CURSOR_PNG_ACTIVE_2X 按下态 2x(64px):同一形状的高分辨率版本
   *
   * 为什么要有按下态:
   *   只有一张图时,按下左键光标毫无变化 —— 拖了半天没有「抓紧了」的实感。
   *   各系统 grabbing 光标本来就是蜷起的拳头,这里照此还原,补上按下反馈。
   *
   * 为什么要有 2x(2026-10-11 用户反馈「抓手很糊」):
   *   Windows 显示缩放 125% / 150% 时,32px 位图被 Chromium 按 DPR 放大渲染,
   *   边缘必然发虚。补一张 64px 的 2x 图,经 -webkit-image-set() 交给高分屏
   *   按原生分辨率渲染;Chromium 自 2012 年起支持且可用于 cursor 属性。
   *   注入样式时同时下发两条 cursor 声明(见 buildCss):
   *     第 1 条 纯 url(32px) —— 所有内核都认,保底行为与旧版一致;
   *     第 2 条 -webkit-image-set(1x, 2x) —— 不认这条声明的内核会整条丢弃,
   *     落回第 1 条;认的内核则按屏幕 DPR 选图(≤1x 用 32px,>1x 用 64px)。
   *   热点写在 image-set() 之后,按 1x 图像素坐标给,浏览器自行按分辨率换算。
   *
   * 来源:scripts/make-cursor.py —— 8 倍超采样绘制后 LANCZOS 缩到 32/64,
   * alpha 膨胀一圈减去原剪影得到外轮廓环,填近黑 #1A1A1E 垫在白色手形下方;
   * 描边环模糊量 0.28 → 0.18,边缘比旧版更立。
   * 实测量化(1x / 2x 全部达标):白底边界对比 >=150、浅灰底 >=140
   * (>=100 即为清晰可辨);锐度(过渡像素占比)见脚本输出。
   *
   * 为什么内联而不是放 icons/ 走文件:
   *   · 不产生网络请求,不会「先显示旧光标再闪一下」;
   *   · 不占用 web_accessible_resources(扩展资源暴露面小一号)。
   * 代价:受页面 CSP 的 img-src 约束 —— 已由 probeCursorImage() 兜底。
   */
  var CURSOR_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAESElEQVR42uVXS2gbVxS9781Iox+S6pElxZEtWzK2U6myFlEMrYVDDcWbhlJi6Da0eFFCN6EQ4mTRhpYSKJRuu04IpSk0GLc4H+o6ycYODYZQWge7yJ9IsmVLtWx9Zt67XUhyHFuqxr920QtiRtJczn3nnnPfPID/e5BDzMX/unD6bwFTAABCCLS0dB0DgKZIpF/e8T85CvCtFYbD4UZZdv3kdB6LdXYGfrda5Zjb3TxMyKG1t3pEIhEZwOyUZdengUA3Tk5OZdbW1grXrn2ZlWVXzuVy9TidTtfQ0JDu0Ffu8bR8YLU2zAUCoT8kyZS8evWzFXwR+UAgtNzS4ps/frx1zm5vfNTa2tlZzhUOLLa+vj671SovXLjwcX51dbUwNfU4c//+z/OMMWSMYS6XL968+e3c8vJyYWbm2V89PW+gzeb4mrzoCT1QAUajscnv73yWzWYL21bNtm4Y44jIy1/59es3CoTobzidTlc43NuoSVj/FLlcDk0mE2eMCYgIjLGXcimlhHNOikUFOedEkgx5URTebGx0T8zO/vbY7W4eriVMzdQgclKxH6W70yilIAgUKKXQ3OzZGBv7UTcxMd56+fKlhnw+P9zeHvCXhxXVSr0AAGL56gkGu2cymYyKiMg5xzrBtt0XTp16PaHT6cJlTbxUgFgDHAGAUUoAgEAwGFxDpHwvzuGcAyEECCHUYrGAoiickN2jQawGPjAwID158vS9eHyhHYDnpqen5a6ugF0QBK7VVtvbxDmr+Zy4U/GhUMg8NfXrd5JkGDh//iPF52sjsViMPHz4KME5qgBwqENG3CFIlkisDEqSYWBk5IflcLjbXmEllUoZRVEUjmy+V2hLJJ77z559txgOdzcoiqJTVVVgjImyLL9iNBr0FSccBQMVwxXa2trECpAoiuU+cqQlVR4dA5XfVFXFkvcRKtejAN9VACKCJBnp+PgvCAB5na6kt8OkvG4BTU2eexMTD8QrVz5R19ezmwCgKoqSY4zx/YJUmNS8+Xg83g8tFvv8iROvJaPR08lo9PRiNpvd1DgFd4ba3/9WHABC1SZhzSIikYjbbDYHAISvTp7sURFxTwVwXprGiURyo6Pj1bTNZgtXdV41xgCATk5OxnO53FNKMXnmzNsAAHpVVTXrgbES7Xfv3mOzs3PPo9HoQrW351p0cAAQGWOUc67X60v255yXe1q/AM45lsHMqlp8MDo6ulIe46h1O0ZKKTeZrIXbt0cIAGyUCwEtJOj1OgIA+Vu3vucGg0FljJF9OaSrKxS0Whs2z517fyMej68jYhERlXqfdDqdvXjxUsZmc6DP19Ffa8FEgyDR6/W/k0qlvnA4HA6v16sSUi+P4OLikri0tLQuy/bPY7E/v9m2ze/53Z0AAA4ODlru3Bn3pdNJTfSZTDba29sTGxsbW60FvpfDAy0LU7MLtg2frdyDHk7JPk47WO/Q+jcsdYt7iPRaowAAAABJRU5ErkJggg==';

  var CURSOR_PNG_ACTIVE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAD0klEQVR42u1XX0hbVxj/nXtO7mLjkuxWo+nUamZBxkZlMivFlw364Jsw4rK2kr20bOJYGYXVsqfMjT34XupLsRPpStmLT13Zs6UPihuIlEJKG6OG6HAxubm5555vDyadtcaaONmLH3xczuXe8/3O7/t7gCM5kiP5n4Ud4r90GGBLqu3je+2/NP7KZuFwuKam5vgJoObEuXMXPdFo1F1ah8Ph2uJnHIAoPg/mgmg06r57d7rONNetjo73epeWkjHDeMvDuUA6nbIAzfH7/R4hhEqlUk5dnfH9s2fxn4kIRJV7gxfVBUA7eTLU5/Uaf7a0vBM/derdx0K47fPnB3PPnyfM1dVV6/LlLzb6+z/ZSCSWzFQqlb9y5Zusx+PbBNgowGPNza2fVu5wxqBpGnRdh2EEFiORCzKRSGZXVlbskZHvni4vL/9F/0rGtu0Xaylltrf3o+ex2KgzNPRVob4+SMFgy6Vth9vbHU1Noc8APgrgOoAxj8e3nE6nM9sMWlJK6TgOOY6jSi+31oosy5K5XG6NiCQRZa9e/bYgRM2EprFXAIgdAKixsemHfD53fWjoS7u9vV2TUqKhoXHN5/O5lVIAQIwxnfMX+7CSjzVtK1Z1XecAjHzeIl13HTt7tofGxsbMLQBU/vQ9PT2G12skb9y4uUFEeSJyilqNKNuWiojUnTu/KMB1swiQl02v+fl5dzAY3BwcvHhMKfWGbdtMSqlJKQ9UqBgrn2zbXQDTNCEEB2Mv01qi9jDkpZ07OzvtRGLpzfv3f9vknEuXy8UO0/h2BggAm5ubSwcCb08PD399aXHxsR0KtWXPnPlQtra2+pRSh8KEtiP3qb7eP0xEI7FYbCISGfjj3r1fAYCKGVCdkT2Ai53da2FhoQDgJyEEdF2/pmm8p8RQtQAsyyKA2H47FgOgT01N8UKhoDNWfVvVNMYA2A8e/G4L4XLtVgO0Mn3ciUQiDgBm23bVAJQiABCnT78vpLTlbiSWdQ4RQQi3MzPzEADsKgOQALC2tjYOMKeioYGI4PMZM7Ozs2Ymk5FEBMdxqDIGtgJ3fX1dAkpUAkABQF/fxw/T6fTq7duTDudccc4rCkRddzEAm5OTU1ptbe1mpXOBBgDBYHOsoaGJbt2aWMvlciYR2fvUQjK5/Pfg4OdZr9cwOzo6Ptg19V9Xy7u6ukQymfoxk8lcCIXaXIZx3CmXUjtdGI8/FWtr6yuBQN21ePzJdKnjVjWSdXd3Nz16NFcH2PuuSH5/AAMD/U/Gx8dzuxnfL4DSJKxe19l2Y2Eb7eqg94JqGwHtdUf4B8rDK0V89xsGAAAAAElFTkSuQmCC';

  // 2x 高分辨率版本(64px),由 scripts/make-cursor.py --write 注入。
  // 占位为空串不影响语法;正式注入前 image-set 行不会被构建(见下方 REPLACE_*)。
  var CURSOR_PNG_2X = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAI40lEQVR42u1bXWxbdxU/5/9xHX8msWuntuM4bVNA6zbBEGuEoBUSPE172UfhZXTrBhIaKhqoUtlA2jTGBpo29jCVB4SqjpdtDxMvrAK1iKKprCwb7STWTRX9sFM7SRPb8ee9/4/DQ+yRVe3WBjtN0hzpPlj3Xv/v/5zfOb/zcS/AuqzLuqzLuqzLTSt4A9e90trUPm5qpeNyGuaGICCbzQ5Ya2MAPvD5AFwXgKiFxphyoVC4tJZdQCSTw7sA8BHOxYi1miulQQgBUgqrlC4iwh8Yo4P5fL7Zfr6eugTvsXLZIkhTMpn9DgAcEEJ8oVIpR4WQJh6PM9d1+8rl8sZAIJAlgm9ZC6Vabf7Eont7ZijWw80TANjOMTQ0FASwDwshI+VypbRnz4On33nnuJ6YeDvw7rv/pP37952p1WrTjDEHEfdkMpmNi+9v/1/XlcF76eeRSCQdicRj0ejGMADdyjnbUy5Xgg899N3cSy+9OBaJRCJCCF8wGAzu2PH1mJRy8s03D4eCwUDIWpyIx9P1QCCc6O8PRoPBIKvVao3VEAOu5OckhHCklCnXdadOnpyQiUQiZoyxnHNmjCHGGCqlq7ff/sVyrVbPIGLB87yWEAJ7GR9Yt5WZTGZ3AeABIcQ3KpXyFmMonEgk/JxzOTU1rRKJITM4GO1DROCcM0QEIQQyxsDnc3yjo6M0MzOjiaxMJBJ+xlhobq6U5Zx/FQB/Ywx+fyXGAAQA6u/PDgDYR67s5ydw374fT9Zq1WlrzdXWZZVKpbR79wPnTpw4bq4SHx5OJjePLIoJK0IYAEAmk9kyPLzpTDgcVXv3PvZvIlJ0mbzxxh//VqnMz7Z/2sXnXNdtvPba60eISF92m33++RdOB4P9zUxm02w6nR5vrykWMc1KUMDYllRq5GwikZotFqdmrLWklDLWWtJaW2MMEVHTGNOiK4gxxiOiurVEWmvbvt8aY8jzvMrWrbdMJhKpuZGRLXd0K4MU3dSCzwdQqSgYGkq4sVg0tNjPOeedh+tj7MoewBiTACAR4ePrhRDYPufLZofLExMzzO8Pjm7efMsl1235ED36fzJI0Qs4EBEQEV3tHOKnGuqqvm0taCFEvzHq5Uaj1lxgCGmNwWIqlVkSQ7CepYFX2eRnbP5TqZkx5OVyWVtrRLcYgsHqEV6tVssrlSEYAMDY2NiWeDx5dtu22y8qpSpERNZa6oa4rnetDLH9eoy7ahAgBBf333/fOBHwNpuA1pqstbh37w+TqVR6znVd5jgOrUkXaDNEoMMQizNIKaVvZCRtlFKWSOBysMDlnMvaEb7Xfnc13yZrl1YXiCWWuZf37uxCHkBejxsYXVewWMLmYWhoc8JxVLjT0iIi1Frreh03AYCzAAbCVRFbrmfzqVT2SwD2QUQzDiDiWrew1TILHMU5OQ6XnPONAJhfSwpAAKB0euQua+0LUsrPNRpNaDTqzVgsWotGoxoAoFZr8NnZS35ExhOJBIdVIuJaNp9MjtxhLb0opdxaKpVat912a+7xx/eL8fHt4UgkElxQQF2fOnVq9umnf3np9OkPWgAQXe0K6ECYEdFux5FbS6VS8+677zp38ODvh6WU4cUXDw4OwM6dO6I7d+5ovfzygbeVUinHcQARV1Tdfr0IoKGhzXHOzXiz2YRt227NHTp0MMM5DymliHMO2E7uEZG01iCE6Hv00R98bREb4GpGAC1Eexmv1WrNJ5/8mdPZvJTy8o2hEALaRSC/hqJntQRBH2jdwg0bNtS2b78zQkTAOb/uKnDFZpjX0uTQ2kB/f0SHQiGJiB/Dfi0I60aT46ZQwFqz/DUrwHUBOGdQq9V5q9XSaw0J7LOh30IpHZieng6ePHmyiohgrb0pEEALCOA1Iir19fUFnnnmuSYAuEII1Fp/AghEBNZaWnMImJk5P6O1mQiFQnjs2N9T+/bt/w8AtIQQnwgJiAiMMVxrCGAAYADoFaX0xVgsFj5w4LfD99777fPvvfevvFKqCgAtAHC11o1cLpfTWnurSQGflQhZAMBiMX8snc78VCn161gsNnT06F8/f+TIkdLoaLYSjcYs56inp2ecZrNVfP/99waEEM419P9XTTlMAACTk7lDyWSmoJT+XigU/DIARC9eLIQuXMhZxjBMBDKVSrIbRJXIOet5RwgKhdxfxsbGjjUajSyiMxgKha0xEAbQz3me9xUArHLOI8u160UoU4XCFF+IS5p62hM8c+aMCwAfwf/eBNlIxALVatU89tiPkHMeNMZ8ar3QLbHWEuccDh16ZercubPJwcGo63ke9rItTotefhIAwLTmYWNs2HGc+fvuuzeyHG92dazPOcdWq1V56qlfeOFwOEBkphljl3o9F/jEy09+P7Oep2wiMeSm06lAu4ff8zjQCTV9fX196XQqoJS2jPHXcrnc2bYR7DIORggYu2G1Agoh0VpT9fn4nzrMtWyTIdcFcByJMzMzztTUVHO5MsL2zBHq9Ubz/PlzwnEcMsbY5ZwO0wIUPcs59+r1euTw4T/PL1etYIwBRIS33nqrXCgU+x3H0a2WMcs+Hq/VnFlj7PmBgQHx7LO/4nNzc7NSSlRKdSbDXQ18AECdlpxSqvrEEz/3QqFQkMhOcm6Li42zHAjAubkz89bao0IIKJfLw/fcs+vS3FxpVkqJjHU3L+r0X6WU6Lpu5YEHHpz88MOPMn6/H7S2x/L5fOF6WYh3Y1YXCkVzROZOv98/euHChYFXX319Kh7fUEqlkuT3+2GhngDdhUPNz1drR44cLe7evad6/Pg/soODUb/nqdOc28er1WrxervQ3TBPe3KUHbfWviSEuFMpBfPz881YbEMlm814nZk90dLWQ1ywqNYa8/m8LBanIsFgMLhgefWBtewnxeL5N5eSg3QLnwgAlMlktiiFj3CO32SMjSilfJ7ndS0QICJKKdFxHENk89baY4jid5OTZ08tNQHrJm9//ADxeHajlJBEREdK2dXor5QCa61mzExNTk7mL18bVsDnMLiavnvCVayIm+IDq3VZlx7LfwGu/zzdHobUlQAAAABJRU5ErkJggg==';

  var CURSOR_PNG_ACTIVE_2X = 'data:image/png;base64,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';

  // 图内热点:抓取点落在掌心(四指指根与掌体交汇处)。
  // 数值为 1x 图(32px)的像素坐标,原点左上。两张图形状不同,热点需分别给;
  // image-set 选中 2x 图时由浏览器按分辨率自行换算,无需另给。
  var HOTSPOT_X = 15;
  var HOTSPOT_Y = 18;

  var HOTSPOT_ACTIVE_X = 14;
  var HOTSPOT_ACTIVE_Y = 16;

  var MARK_ATTR = 'data-dyc-cursor-fix';

  /**
   * 当前生效的光标值(悬停态 / 按下态各一)。
   *
   * REPLACE_CURSOR(_ACTIVE)          纯 url(32px) 行:所有内核都认的保底;
   * REPLACE_CURSOR_HIDPI(_ACTIVE)    -webkit-image-set(1x, 2x) 行:
   *                                  高分屏按原生分辨率渲染,消除放大发糊。
   *                                  声明内自带 url(32px) 兜底 —— 即使内核认
   *                                  image-set 但 2x 图被 CSP 拦掉,也会落回
   *                                  同一声明里的 1x url,不会跳变。
   * probeCursorImage() 实测失败时分别退回:FALLBACK_CURSOR / 纯 url 行。
   */
  var FALLBACK_CURSOR = 'move';

  var REPLACE_CURSOR = 'url("' + CURSOR_PNG + '") ' + HOTSPOT_X + ' '
    + HOTSPOT_Y + ', ' + FALLBACK_CURSOR;

  var REPLACE_CURSOR_ACTIVE = 'url("' + CURSOR_PNG_ACTIVE + '") '
    + HOTSPOT_ACTIVE_X + ' ' + HOTSPOT_ACTIVE_Y + ', ' + FALLBACK_CURSOR;

  var REPLACE_CURSOR_HIDPI = REPLACE_CURSOR;
  var REPLACE_CURSOR_HIDPI_ACTIVE = REPLACE_CURSOR_ACTIVE;

  // 2x 图已注入才构建 image-set 行;占位空串时保持纯 url 行,行为同旧版。
  if (CURSOR_PNG_2X && CURSOR_PNG_ACTIVE_2X) {
    REPLACE_CURSOR_HIDPI = '-webkit-image-set(url("' + CURSOR_PNG
      + '") 1x, url("' + CURSOR_PNG_2X + '") 2x) ' + HOTSPOT_X + ' '
      + HOTSPOT_Y + ', ' + REPLACE_CURSOR;

    REPLACE_CURSOR_HIDPI_ACTIVE = '-webkit-image-set(url("' + CURSOR_PNG_ACTIVE
      + '") 1x, url("' + CURSOR_PNG_ACTIVE_2X + '") 2x) '
      + HOTSPOT_ACTIVE_X + ' ' + HOTSPOT_ACTIVE_Y + ', ' + REPLACE_CURSOR_ACTIVE;
  }

  /**
   * 拼一条规则的 cursor 声明:纯 url 行在前, image-set 行在后。
   * 同优先级后者胜出 —— 认 image-set 的内核用高分屏版本,
   * 不认的整条丢弃第 2 条声明,由第 1 条接管(行为与旧版完全一致)。
   */
  function cursorDecls(normal, hidpi) {
    return 'cursor: ' + normal + ' !important; cursor: ' + hidpi
      + ' !important;';
  }

  var enabled = false;
  var scanned = new WeakSet();   // 已做过「非悬停态」扫描的元素
  var hovered = new WeakSet();   // 已做过「悬停态」实测的元素

  /* ==========================================================
   * 基础工具
   * ========================================================== */

  function cursorOf(el) {
    try {
      return window.getComputedStyle(el).cursor || '';
    } catch (e) {
      return '';
    }
  }

  function isGrab(c) {
    return c === 'grab' || c === 'grabbing';
  }

  function mark(el) {
    if (el && el.nodeType === 1 && !el.hasAttribute(MARK_ATTR)) {
      el.setAttribute(MARK_ATTR, '');
    }
  }

  /* ==========================================================
   * 路径 A:从页面样式表收集 grab 规则
   * ========================================================== */

  /** 递归遍历规则表,收集 cursor 含 grab 的选择器 */
  function walkRules(rules, out) {
    for (var i = 0; i < rules.length; i++) {
      var r = rules[i];
      try {
        if (r.selectorText && r.style && r.style.cursor
            && /grab/i.test(r.style.cursor)) {
          if (out.indexOf(r.selectorText) === -1) out.push(r.selectorText);
        }
        // @media / @supports 等嵌套规则继续下探
        if (r.cssRules && r.cssRules.length) walkRules(r.cssRules, out);
      } catch (e) {
        // 个别规则不可读,跳过即可,不影响其余
      }
    }
  }

  /**
   * 收集平台所有 grab 选择器。
   * 跨域样式表会抛 SecurityError —— 静默跳过,由路径 B/C 补位。
   */
  function collectGrabSelectors() {
    var out = [];
    var sheets = document.styleSheets;
    for (var i = 0; i < sheets.length; i++) {
      var rules;
      try {
        rules = sheets[i].cssRules;
      } catch (e) {
        continue;   // 跨域表,读不到
      }
      if (rules) walkRules(rules, out);
    }
    return out;
  }

  /** 拼出完整的覆盖样式 */
  function buildCss() {
    var parts = [];

    // 1) 属性标记规则 —— 路径 B / C 命中的元素由它接管。
    //    前面加 html body 提升优先级,避免被平台同样带 !important 的规则压过。
    parts.push('html body [' + MARK_ATTR + '] { '
      + cursorDecls(REPLACE_CURSOR, REPLACE_CURSOR_HIDPI) + ' }');
    parts.push('html body [' + MARK_ATTR + ']:active { '
      + cursorDecls(REPLACE_CURSOR_ACTIVE, REPLACE_CURSOR_HIDPI_ACTIVE) + ' }');

    // 2) 平台原有 grab 规则的替代规则,选择器原样照搬(含 :hover / :active)
    var sels = collectGrabSelectors();
    for (var i = 0; i < sels.length; i++) {
      var s = sels[i];
      if (/:active/.test(s)) {
        // 选择器本身就带 :active,已是按下态:只出按下光标一条,
        // 不再垫一条悬停光标(多余,且会被同优先级的后者覆盖,纯浪费)
        parts.push(s + ' { ' + cursorDecls(REPLACE_CURSOR_ACTIVE,
          REPLACE_CURSOR_HIDPI_ACTIVE) + ' }');
      } else {
        parts.push(s + ' { ' + cursorDecls(REPLACE_CURSOR,
          REPLACE_CURSOR_HIDPI) + ' }');
        parts.push(s + ':active { ' + cursorDecls(REPLACE_CURSOR_ACTIVE,
          REPLACE_CURSOR_HIDPI_ACTIVE) + ' }');
      }
    }

    return parts.join('\n');
  }

  function apply() {
    if (!enabled) return;
    if (!document.head && !document.documentElement) return;

    var el = document.getElementById(STYLE_ID);
    if (!el) {
      el = document.createElement('style');
      el.id = STYLE_ID;
    }
    el.textContent = buildCss();

    // appendChild 已存在的节点会把它移到末尾 —— 保证我们的规则排在平台
    // 后插入的样式表之后,同优先级下由后者胜出。
    (document.head || document.documentElement).appendChild(el);
  }

  /* ==========================================================
   * 路径 B:悬停态实测
   *
   * 在 mouseover / mousedown 的捕获阶段检查光标。此刻元素正处于悬停
   * (或按下)状态,getComputedStyle 返回的就是用户真实看到的那一个光标,
   * 于是 :hover 规则与跨域样式表都能被准确识别。
   * ========================================================== */

  function probe(el) {
    if (!enabled) return;
    if (!el || el.nodeType !== 1) return;
    if (hovered.has(el)) return;
    hovered.add(el);

    if (el.hasAttribute(MARK_ATTR)) return;
    if (isGrab(cursorOf(el))) el.setAttribute(MARK_ATTR, '');
  }

  function onProbe(e) {
    probe(e.target);
  }

  /* ==========================================================
   * 路径 C:DOM 扫描(内联样式 / 跨域表兜底)
   * ========================================================== */

  function scanList(nodes, force) {
    if (!enabled) return;
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (el.nodeType !== 1) continue;
      if (!force) {
        if (scanned.has(el)) continue;
        scanned.add(el);
      }
      if (el.hasAttribute(MARK_ATTR)) continue;
      if (isGrab(cursorOf(el))) el.setAttribute(MARK_ATTR, '');
    }
  }

  /** 节点及其子树 */
  function scanDom(root, force) {
    if (!root) return;
    var nodes = [];
    if (root.nodeType === 1) nodes.push(root);
    try {
      var found = root.querySelectorAll('*');
      for (var i = 0; i < found.length; i++) nodes.push(found[i]);
    } catch (e) { /* 忽略 */ }
    scanList(nodes, force);
  }

  /**
   * 开局全量扫描,分片执行。
   *
   * 抖店 / 百应页面节点上万,一次性对所有节点跑 getComputedStyle 会造成
   * 可感知的卡顿。因此切成小批,优先在浏览器空闲时执行。
   */
  function scanAll() {
    var all = [];
    try {
      var found = document.querySelectorAll('*');
      for (var i = 0; i < found.length; i++) all.push(found[i]);
    } catch (e) {
      return;
    }

    var idx = 0;
    var CHUNK = 400;

    function idle(fn) {
      if (window.requestIdleCallback) {
        window.requestIdleCallback(fn, { timeout: 1000 });
      } else {
        setTimeout(fn, 0);
      }
    }

    function step() {
      if (!enabled) return;
      var end = Math.min(idx + CHUNK, all.length);
      scanList(all.slice(idx, end), false);
      idx = end;
      if (idx < all.length) idle(step);
    }

    idle(step);
  }

  /* ---- 增量监听:新节点 + class/style 变化 ---- */

  var mo = null;

  /* ---------- 变异批次的消费:时间片分片(2026-10-21 性能修复) ----------
   *
   * 【为什么要分片】平台整列表重挂(自动刷新/切直播)时,addedNodes 里
   *   常是一整棵子树、几百上千个元素。原写法在一个 setTimeout 回调里
   *   对全部新元素跑 getComputedStyle —— 形成 50ms 级长任务,且恰好在
   *   平台渲染潮之后,把圆钮这类 CSS 过渡该得的帧全挤掉(用户感知:
   *   「中控台运转时连上滑下滑按钮的动效都卡」)。开局全量 scanAll
   *   一直有 400/批 + 空闲分片,增量路径原本没设防 —— 本次对齐。
   *
   * 【怎么分】不再 querySelectorAll('*') 一次性物化子树,改用 TreeWalker
   *   游标:扫到哪算哪,每片最长 SLICE_MS(8ms)/节点数 NODE_CAP(600) 兜底,
   *   到限就把游标留在队列里等下一个空闲片;先来先扫,不饿死后面的子树。
   *
   * 【不漏的闭环】已扫过的元素走 scanned 缓存跳过(新元素必不在缓存,
   *   照查);被复用/移动的旧元素 cursor 没变就不重查,若它自身
   *   class/style 变了会走 attributes 事件的单元素强制重查 —— 两条路
   *   合起来覆盖原「force 全子树重查」的语义,成本从每批全量降为增量。
   */
  var SLICE_MS = 8;      // 每个时间片的最长主线程占用
  var NODE_CAP = 600;    // 每片节点数兜底(防个别节点异常慢拖垮时间片)

  function observe() {
    if (mo || !window.MutationObserver) return;
    if (!document.documentElement) return;

    var queue = [];   // {el, self} —— self=true:只查元素自身(attributes 路径)
    var timer = 0;

    /* 消费队列:时间片分片,单片最长 SLICE_MS / NODE_CAP 兜底 */
    function flushQueue() {
      function step() {
        var start = Date.now();
        var n = 0;

        while (queue.length > 0) {
          var item = queue[0];
          var el = item.el;

          if (item.self) {
            /* 单元素强制重查(attributes 路径):量级 O(1) */
            queue.shift();
            if (el.isConnected) scanList([el], true);
            n += 1;
          } else {
            /* 子树:懒物化,游标遍历 —— 不一次性物化全部节点 */
            if (!el.isConnected) { queue.shift(); continue; }
            if (!item.walker) {
              try {
                item.walker = document.createTreeWalker(el, NodeFilter.SHOW_ELEMENT, null);
              } catch (e) { queue.shift(); continue; }
            }
            var node = item.walker.nextNode();
            while (node) {
              if (!scanned.has(node)) {
                scanned.add(node);
                if (!node.hasAttribute(MARK_ATTR) && isGrab(cursorOf(node))) {
                  node.setAttribute(MARK_ATTR, '');
                }
              }
              n += 1;
              if (Date.now() - start > SLICE_MS || n > NODE_CAP) break;
              node = item.walker.nextNode();
            }
            if (!node) {
              queue.shift();   /* 本子树遍历完 —— 摘掉,轮到下一个 */
            } else {
              break;           /* 时间片/配额用完 —— 游标留在队列里 */
            }
          }

          if (Date.now() - start > SLICE_MS || n > NODE_CAP) break;
        }

        if (queue.length > 0) {
          if (window.requestIdleCallback) {
            window.requestIdleCallback(step, { timeout: 500 });
          } else {
            setTimeout(step, 0);
          }
        }
      }

      step();
    }

    mo = new MutationObserver(function (muts) {
      if (!enabled) return;

      for (var i = 0; i < muts.length; i++) {
        var m = muts[i];

        if (m.type === 'attributes') {
          /* class / style 变了,元素光标可能刚变成 grab —— 强制重查它**自身**。
           * 【性能 2026-10-21】原写法 push(m.target) 后走 scanDom 子树全扫:
           *   React 高频改 style/class 的元素(进度条/倒计时/人气)每帧触发,
           *   等于每 300ms 对同一子树全量 getComputedStyle —— 运转时卡顿
           *   的另一半主力。cursor 由元素**自身**的样式决定,祖先的
           *   class/style 变更不改变子元素的 computed cursor(除非子元素
           *   显式写 cursor:inherit —— 平台拖拽区实际都把 grab 写在自己
           *   身上);子元素自己的 class/style 变更会触发它自己的
           *   attributes 事件,初次挂载也会被 childList 路径扫到,
           *   收窄到单元素不会漏。 */
          if (m.target && m.target.nodeType === 1) {
            queue.push({ el: m.target, self: true });
          }
          continue;
        }

        var added = m.addedNodes;
        for (var j = 0; j < added.length; j++) {
          if (added[j].nodeType === 1) queue.push({ el: added[j], self: false });
        }
      }

      if (queue.length === 0 || timer) return;

      // 合并一次渲染潮里的所有变化,避免逐个跑 getComputedStyle
      timer = setTimeout(function () {
        timer = 0;
        flushQueue();
      }, 300);
    });

    mo.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'class']
    });
  }

  /* ==========================================================
   * CSP 探针:确认自定义光标图真的能用
   *
   * data: 形式的图片走页面的 img-src 检查。平台若是严格 CSP,
   * 浏览器会**静默丢弃**光标图并落到兜底关键字 —— 不报错、难排查,
   * 表现就是「改了却没生效」。
   *
   * 这里用 new Image() 加载同一张 data URI 实测:
   *   · 成功 → 保留自定义图
   *   · 失败 → 换回纯关键字(至少保证「看得见」这个底线)
   *
   * 注意 probe 的是图片能否解码,不是 iframe —— 光标图的加载上下文
   * 就是当前文档,与页面 CSP 同源判定,因此这个探针结论是可信的。
   * ========================================================== */

  function probeCursorImage(done) {
    var pending = 4;   // 悬停 1x/2x + 按下 1x/2x,四张都要实测
    var failedAny = false;
    var failed2x = false;
    var settled = false;

    function finish() {
      if (settled) return;
      settled = true;

      if (failedAny) {
        // 任一张 1x 图被拦就整组退回关键字 —— 只退回一张会造成
        // 「悬停有手、按下变箭头」的割裂感,不如整组保持一致的兜底。
        REPLACE_CURSOR = FALLBACK_CURSOR;
        REPLACE_CURSOR_ACTIVE = FALLBACK_CURSOR;
        REPLACE_CURSOR_HIDPI = FALLBACK_CURSOR;
        REPLACE_CURSOR_HIDPI_ACTIVE = FALLBACK_CURSOR;
        console.warn('[DYC-CURSOR] 自定义光标图被 CSP 拦截或无法解码,'
          + '退回关键字 ' + FALLBACK_CURSOR + '(手型将不可用,但不会隐形)');
      } else if (failed2x) {
        // 仅 2x 被拦(理论上少见:CSP 拦 data: 是不分分辨率的):
        // 只退 image-set 行,保底行继续用 1x 自定义图。
        REPLACE_CURSOR_HIDPI = REPLACE_CURSOR;
        REPLACE_CURSOR_HIDPI_ACTIVE = REPLACE_CURSOR_ACTIVE;
        console.warn('[DYC-CURSOR] 2x 光标图不可用,高分屏退回 1x 图');
      }
      done();
    }

    function one(src, is2x) {
      var img = new Image();
      var doneOne = false;
      function settle(ok) {
        if (doneOne) return;
        doneOne = true;
        if (!ok) {
          if (is2x) failed2x = true;
          else failedAny = true;
        }
        if (--pending === 0) finish();
      }
      img.onload = function () { settle(true); };
      img.onerror = function () { settle(false); };
      // 兜底:异常环境下 onload / onerror 可能都不触发,不能一直等
      setTimeout(function () { settle(false); }, 800);
      img.src = src;
    }

    one(CURSOR_PNG, false);
    one(CURSOR_PNG_2X || CURSOR_PNG, true);
    one(CURSOR_PNG_ACTIVE, false);
    one(CURSOR_PNG_ACTIVE_2X || CURSOR_PNG_ACTIVE, true);
  }

  /* ==========================================================
   * 开关
   * ========================================================== */

  /**
   * 延迟补扫。
   *
   * 平台是 Garfish 微前端,子应用挂载后才把样式表分批注入文档。
   * 开局那一次收集只能拿到主应用的样式,因此再排几次补扫,
   * 把后续到位的样式表与 DOM 一并纳入。次数有限,跑完即止。
   */
  function scheduleRescan() {
    var delays = [500, 1500, 3000, 6000, 10000];
    delays.forEach(function (d) {
      setTimeout(function () {
        if (!enabled) return;
        apply();
        scanDom(document.documentElement, false);
      }, d);
    });
  }

  function bindProbes() {
    // 捕获阶段监听,抢在平台自身处理之前拿到目标元素
    document.addEventListener('mouseover', onProbe, true);
    document.addEventListener('mousedown', onProbe, true);
  }

  function enable() {
    if (enabled) return;
    enabled = true;

    // 先探针再注入:探针会把 REPLACE_CURSOR 定下来(可能退回关键字),
    // buildCss() 随后读到的是最终值。异步,不阻塞页面。
    probeCursorImage(function () {
      if (!enabled) return;   // 探针返回前被关掉,不注入

      apply();
      scanAll();
      observe();
      bindProbes();
      scheduleRescan();

      console.log('[DYC-CURSOR] 抓手光标修复:已开启'
        + (REPLACE_CURSOR.indexOf('url(') === 0 ? '(自定义手型)' : '(关键字兜底)'));
    });
  }

  function disable() {
    if (!enabled) return;
    enabled = false;

    var el = document.getElementById(STYLE_ID);
    if (el) el.remove();

    document.removeEventListener('mouseover', onProbe, true);
    document.removeEventListener('mousedown', onProbe, true);

    // 元素上的属性标记保留即可 —— 覆盖样式已移除,不会再影响光标;
    // 若再次开启,enable() 会重新注入样式让标记立即恢复作用。
    console.log('[DYC-CURSOR] 抓手光标修复:已关闭,光标交还页面');
  }

  /* ==========================================================
   * 启动
   * ========================================================== */

  dycReadFlags().then(function (flags) {
    if (flags.cursorFix === false) {
      console.log('[DYC-CURSOR] 抓手光标修复:开关为关闭,跳过');
      return;
    }
    enable();
  });

  // 开关变化即时生效,无需刷新页面
  // 状态条统一反馈(2026-10-11):开关切换报一声,首次对齐不报
  var prevCursorFix = null;
  dycWatchFlags(function (flags) {
    var on = flags.cursorFix !== false;
    if (prevCursorFix !== null && on !== prevCursorFix && typeof toast === 'function') {
      toast(on ? '已开启' : '已关闭', 'info', { source: '抓手光标' });
    }
    prevCursorFix = on;
    if (flags.cursorFix === false) {
      disable();
    } else if (!enabled) {
      enable();
    }
  });
})();