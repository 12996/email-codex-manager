# CHG-094 协议注册单并发队列

状态：implemented
创建日期：2026-07-23
关联 PRD：PRD-003

协议注册改为服务进程内 FIFO 单并发队列。页面可连续加入多个账号；服务重启后队列丢弃。`GET /protocol-registration-queue` 返回当前、等待和最近结果，以及每个已开始或已结束任务的实时日志；`DELETE /protocol-registration-queue` 仅清空等待任务。补号管理页的队列面板只显示状态和顺序；当前执行账号的子进程实时日志显示在独立的“当前协议注册日志”面板。
