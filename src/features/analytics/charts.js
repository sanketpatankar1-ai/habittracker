export function createCharts({ css, warn }) {
  let dailyChart = null, weeklyChart = null, donutChart = null;
  const displayPercent = (value) => Number.isFinite(value) ? `${Math.round(value)}%` : '–';
  const percentageLabels = {
    id: 'pct',
    afterDatasetsDraw(chart) {
      const { ctx } = chart;
      ctx.save(); ctx.font = '400 10.5px Hanken Grotesk'; ctx.textAlign = 'center';
      chart.getDatasetMeta(1).data.forEach((bar, index) => {
        const value = chart.data.datasets[1].data[index], info = chart.weekInfo?.[index];
        const label = value == null ? '–' : `${Math.round(value)}%${info?.includesPlan ? '*' : ''}`;
        ctx.fillStyle = value == null ? css('--mut') : css('--tx');
        ctx.fillText(value == null ? label : `${Math.round(value)}%${info?.includesPlan ? '*' : ''}`, bar.x, (value == null ? chart.chartArea.bottom : bar.y) - 7);
      });
      ctx.restore();
    },
  };
  const glow = {
    id: 'glow',
    beforeDatasetsDraw(chart) {
      const arc = chart.getDatasetMeta(0).data[0]; if (!arc) return;
      const { ctx } = chart; ctx.save(); ctx.beginPath();
      ctx.arc(arc.x, arc.y, (arc.innerRadius + arc.outerRadius) / 2, 0, Math.PI * 2);
      ctx.lineWidth = arc.outerRadius - arc.innerRadius;
      ctx.strokeStyle = `rgba(${css('--rgb')},.1)`; ctx.stroke(); ctx.restore();
    },
    beforeDatasetDraw(chart, args) {
      if (args.index === 0) { chart.ctx.save(); chart.ctx.shadowColor = css('--glow'); chart.ctx.shadowBlur = 10; }
    },
    afterDatasetDraw(chart, args) { if (args.index === 0) chart.ctx.restore(); },
  };

  function rebuild() {
    [dailyChart, weeklyChart, donutChart].forEach((chart) => chart?.destroy());
    dailyChart = weeklyChart = donutChart = null;
    const Chart = window.Chart;
    if (typeof Chart !== 'function') { warn('Charts are unavailable because Chart.js could not be loaded. The habit tracker is still ready to use.'); return false; }
    const canvases = ['dailyChart', 'weeklyChart', 'donutChart'].map((id) => document.getElementById(id));
    if (canvases.some((canvas) => !canvas)) { warn('Charts could not start because a dashboard chart element is missing.'); return false; }
    const text = css('--text-primary'), accent = css('--accent'), muted = css('--text-secondary');
    const line = css('--chart-grid'), surface = css('--surface'), rgb = css('--rgb');
    Chart.defaults.color = muted; Chart.defaults.font.family = 'Hanken Grotesk';
    const tooltip = { backgroundColor: surface, borderColor: text, borderWidth: 1, padding: 9, cornerRadius: 3, displayColors: false, titleColor: text, bodyColor: muted };
    const yAxis = { min: 0, max: 100, grid: { color: line, drawTicks: false }, border: { display: false }, ticks: { stepSize: 50, padding: 8, font: { size: 10 }, callback: (value) => `${value}%` } };

    let nextDaily = null, nextWeekly = null, nextDonut = null;
    try {
    nextDaily = new Chart(canvases[0], {
      type: 'bar',
      data: { labels: [], datasets: [
        { type: 'bar', label: 'Daily', data: [], backgroundColor: `rgba(${rgb},.28)`, hoverBackgroundColor: `rgba(${rgb},.6)`, borderRadius: 2, barPercentage: 0.62, categoryPercentage: 1, order: 2 },
        { type: 'line', label: '7-day completion rate', data: [], borderColor: accent, borderWidth: 1.5, cubicInterpolationMode: 'monotone', pointRadius: 0, pointHoverRadius: 4, pointHoverBackgroundColor: accent, order: 1 },
      ] },
      options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: false }, tooltip: { ...tooltip, callbacks: {
          title: (items) => `Day ${items[0].label}`,
          label: (item) => {
            if (item.datasetIndex !== 0) return `${item.dataset.label}: ${displayPercent(item.parsed.y)}`;
            const stats = dailyChart?.dailyStats?.[item.dataIndex];
            if (dailyChart?.plannedDays?.[item.dataIndex]) return stats ? `Planned: ${stats.plannedDone}/${stats.plannedGoal} scheduled habits (${displayPercent(item.parsed.y)})` : `Planned: ${displayPercent(item.parsed.y)}`;
            return stats ? `Done: ${stats.done}/${stats.goal} eligible habits (${displayPercent(item.parsed.y)})` : `Done: ${displayPercent(item.parsed.y)}`;
          },
        } } },
        scales: { x: { grid: { display: false }, border: { display: false }, ticks: { font: { size: 10 }, maxTicksLimit: 16 } }, y: yAxis },
      },
    });
    nextWeekly = new Chart(canvases[1], {
      type: 'bar', plugins: [percentageLabels],
      data: { labels: [], datasets: [
        { data: [], backgroundColor: `rgba(${rgb},.08)`, borderRadius: 2, barPercentage: 0.42, categoryPercentage: 1, grouped: false, order: 2 },
        { data: [], backgroundColor: accent, borderRadius: 2, barPercentage: 0.42, categoryPercentage: 1, grouped: false, order: 1 },
      ] },
      options: { responsive: true, maintainAspectRatio: false, layout: { padding: { top: 16 } },
        plugins: { legend: { display: false }, tooltip: { ...tooltip, filter: (item) => item.datasetIndex === 1, callbacks: { label: (item) => {
          const week = weeklyChart.weekInfo?.[item.dataIndex]; if (!week) return 'No weekly data';
          const lines = [];
          lines.push(`Dates: ${week.start}–${week.end}`);
          if (week.goal) lines.push(`Completed: ${week.done}/${week.goal} scheduled occurrences`);
          if (week.includesPlan) lines.push(`Pre-marked future: ${week.plannedDone}/${week.plannedGoal} scheduled days`);
          if (week.rate !== null) lines.push(`${week.includesPlan ? 'Projected' : 'Completed'} weekly rate: ${displayPercent(week.rate)}`);
          if (!lines.length) lines.push('No completed or planned scheduled days');
          return lines;
        } } } },
        scales: { x: { grid: { display: false }, border: { display: false } }, y: { ...yAxis, display: false } },
      },
    });
    nextDonut = new Chart(canvases[2], {
      type: 'doughnut', plugins: [glow],
      data: { labels: ['Done and planned', 'Remaining'], datasets: [{ data: [0, 100], borderWidth: 0, borderRadius: (context) => context.dataIndex === 0 ? 24 : 0, backgroundColor: [accent, 'rgba(0,0,0,0)'] }] },
      options: { responsive: true, maintainAspectRatio: false, cutout: '82%', layout: { padding: 0 }, animation: { duration: 900, easing: 'easeOutQuart' }, plugins: { legend: { display: false }, tooltip: { enabled: false } } },
    });
    dailyChart = nextDaily; weeklyChart = nextWeekly; donutChart = nextDonut;
    return true;
    } catch (error) {
      [nextDaily, nextWeekly, nextDonut].forEach((chart) => chart?.destroy());
      console.error('[Habit Tracker] Chart initialization failed.', error);
      warn('Charts could not be initialized. Tracking and saved data are still available.');
      return false;
    }
  }

  function restyle() {
    if (!dailyChart || !weeklyChart || !donutChart) return rebuild();
    try {
      const Chart = window.Chart, text = css('--text-primary'), muted = css('--text-secondary');
      const surface = css('--surface'), line = css('--chart-grid'), accent = css('--accent'), rgb = css('--rgb');
      Chart.defaults.color = muted;
      dailyChart.data.datasets[0].backgroundColor = (dailyChart.plannedDays || []).map((planned) => planned ? `rgba(${rgb},.16)` : `rgba(${rgb},.28)`);
      dailyChart.data.datasets[0].hoverBackgroundColor = `rgba(${rgb},.6)`;
      dailyChart.data.datasets[1].borderColor = accent;
      dailyChart.data.datasets[1].pointHoverBackgroundColor = accent;
      dailyChart.options.scales.y.grid.color = line;
      weeklyChart.data.datasets[0].backgroundColor = `rgba(${rgb},.08)`;
      weeklyChart.data.datasets[1].backgroundColor = (weeklyChart.weekInfo || []).map((week) => week.includesPlan ? `rgba(${rgb},.58)` : accent);
      weeklyChart.options.scales.y.grid.color = line;
      donutChart.data.datasets[0].backgroundColor = [accent, 'rgba(0,0,0,0)'];
      [dailyChart, weeklyChart, donutChart].forEach((chart) => {
        const tooltip = chart.options.plugins.tooltip;
        if (tooltip) Object.assign(tooltip, { backgroundColor: surface, borderColor: text, titleColor: text, bodyColor: muted });
        chart.update();
      });
      return true;
    } catch (error) {
      console.error('[Habit Tracker] Chart theme update failed.', error);
      warn('Charts could not update their theme. Tracking and saved data are still available.');
      return false;
    }
  }

  function update({ dailyBars, dailyAverage, dailyDone, dailyGoal, dailyPlannedDone, dailyPlannedGoal, plannedDays, weekly, overallPercent }) {
    if (!dailyChart || !weeklyChart || !donutChart) return;
    if (!Array.isArray(dailyBars) || !Array.isArray(dailyAverage) || !Array.isArray(plannedDays) || !Array.isArray(weekly)) {
      warn('Analytics data was incomplete; chart updates were skipped.'); return false;
    }
    try {
      const rgb = css('--rgb');
      dailyChart.data.labels = dailyBars.map((_, index) => index + 1);
      dailyChart.plannedDays = plannedDays;
      dailyChart.dailyStats = dailyBars.map((_, index) => ({
        done: dailyDone?.[index] ?? 0, goal: dailyGoal?.[index] ?? 0,
        plannedDone: dailyPlannedDone?.[index] ?? 0, plannedGoal: dailyPlannedGoal?.[index] ?? 0,
      }));
      dailyChart.data.datasets[0].data = dailyBars;
      dailyChart.data.datasets[0].backgroundColor = plannedDays.map((planned) => planned ? `rgba(${rgb},.16)` : `rgba(${rgb},.28)`);
      dailyChart.data.datasets[1].data = dailyAverage;
      dailyChart.update();
      weeklyChart.data.labels = weekly.map((_, index) => `W${index + 1}`);
      weeklyChart.weekInfo = weekly;
      weeklyChart.data.datasets[0].data = weekly.map(() => 100);
      weeklyChart.data.datasets[1].data = weekly.map((item) => Number.isFinite(item.rate) ? item.rate : null);
      weeklyChart.data.datasets[1].backgroundColor = weekly.map((item) => item.includesPlan ? `rgba(${rgb},.58)` : css('--accent'));
      weeklyChart.update();
      const safePercent = Number.isFinite(overallPercent) ? Math.min(100, Math.max(0, overallPercent)) : 0;
      donutChart.data.datasets[0].data = [safePercent, Math.max(0, 100 - safePercent)];
      donutChart.update();
      return true;
    } catch (error) {
      console.error('[Habit Tracker] Chart update failed.', error);
      [dailyChart, weeklyChart, donutChart].forEach((chart) => chart?.destroy());
      dailyChart = weeklyChart = donutChart = null;
      warn('Charts could not update. Tracking and saved data are still available.');
      return false;
    }
  }

  return { rebuild, restyle, update };
}
