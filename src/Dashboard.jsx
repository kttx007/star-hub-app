import React from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip } from 'recharts';

const COLORS = ['#3B82F6', '#F59E0B', '#10B981', '#EF4444'];

const Dashboard = () => {
  // Mock data for prototype
  const stats = [
    { name: '待办战役', value: 3 },
    { name: '执行中', value: 1 },
    { name: '已完成', value: 12 },
    { name: '熔断', value: 2 },
  ];

  const crmData = [
    { name: '广州帝特', info: '采购经理汪经理 (胜为背景)', status: '高意向' },
    { name: '土耳其客户', info: '待发PI', status: '待跟进' },
  ];

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-8 font-sans text-slate-900">
      {/* Header */}
      <header className="mb-8 flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-slate-800">星图中枢·乘法驾驶舱</h1>
          <p className="text-slate-500">A1 总控台 | 2026 规划对齐版</p>
        </div>
        <div className="flex gap-4">
          <button className="bg-blue-600 text-white px-4 py-2 rounded-lg shadow-sm hover:bg-blue-700 transition">快速输入 INBOX</button>
        </div>
      </header>

      {/* Main Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        
        {/* Metric Cards */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
          <h3 className="text-slate-400 text-sm font-medium mb-2">本周乘法系数</h3>
          <div className="text-4xl font-bold text-blue-600">8.4 <span className="text-sm text-green-500">↑ 12%</span></div>
          <p className="text-xs text-slate-400 mt-2">已沉淀 4 项 SOP 资产</p>
        </div>

        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
          <h3 className="text-slate-400 text-sm font-medium mb-2">当前活跃战役</h3>
          <div className="text-4xl font-bold text-slate-800">5</div>
          <p className="text-xs text-orange-500 mt-2">M6 旗舰全案 进行中</p>
        </div>

        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
          <h3 className="text-slate-400 text-sm font-medium mb-2">边界熔断预警</h3>
          <div className="text-4xl font-bold text-red-500">0</div>
          <p className="text-xs text-slate-400 mt-2">能量状态良好</p>
        </div>

        {/* Charts */}
        <div className="md:col-span-2 bg-white p-6 rounded-2xl shadow-sm border border-slate-100 h-80">
          <h3 className="font-bold mb-4">战役状态分布</h3>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={stats} innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value">
                {stats.map((entry, index) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* CRM Quick View */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
          <h3 className="font-bold mb-4">重点客户透视</h3>
          <div className="space-y-4">
            {crmData.map((item, idx) => (
              <div key={idx} className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                <div className="font-bold text-slate-700">{item.name}</div>
                <div className="text-xs text-slate-500 mb-2">{item.info}</div>
                <span className="text-[10px] bg-blue-100 text-blue-600 px-2 py-1 rounded-full">{item.status}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
