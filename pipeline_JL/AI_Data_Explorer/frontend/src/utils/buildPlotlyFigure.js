/**
 * Translates a DeepSeek graph spec + raw CSV data into a Plotly figure object.
 *
 * Supported types: bar, scatter, histogram, box
 */

// Transparent backgrounds so Radix Card's dark surface shows through
const BASE_LAYOUT = {
  plot_bgcolor: 'rgba(0,0,0,0)',
  paper_bgcolor: 'rgba(0,0,0,0)',
  font: { family: 'system-ui, sans-serif', size: 12, color: '#c9d1d9' },
  margin: { t: 30, b: 40, l: 40, r: 15 },
};

const AXIS_STYLE = {
  gridcolor: 'rgba(255,255,255,0.07)',
  linecolor: 'rgba(255,255,255,0.12)',
  tickfont: { color: '#8b949e' },
  zerolinecolor: 'rgba(255,255,255,0.12)',
};

const ACCENT = '#46a7d4'; // sky-9 dark

function axisTitle(label) {
  return {
    ...AXIS_STYLE,
    title: { text: label, font: { size: 12, color: '#8b949e' } },
  };
}

function aggregate(data, xCol, yCol, aggMethod) {
  const groups = {};
  for (const row of data) {
    const key = String(row[xCol]);
    if (!groups[key]) groups[key] = [];
    if (aggMethod === 'count') {
      groups[key].push(1); // just need row presence
    } else {
      const val = Number(row[yCol]);
      if (!isNaN(val)) groups[key].push(val);
    }
  }

  const xValues = Object.keys(groups);
  const yValues = xValues.map((key) => {
    const vals = groups[key];
    if (aggMethod === 'sum') return vals.reduce((a, b) => a + b, 0);
    if (aggMethod === 'count') return vals.length;
    return vals.reduce((a, b) => a + b, 0) / vals.length; // mean
  });

  return { xValues, yValues };
}

function buildBar(data, xCol, yCol, aggMethod, title) {
  const { xValues, yValues } = aggregate(data, xCol, yCol, aggMethod || 'mean');
  const aggLabel = aggMethod || 'mean';

  return {
    data: [{ type: 'bar', x: xValues, y: yValues, marker: { color: ACCENT } }],
    layout: {
      ...BASE_LAYOUT,
      title: { text: title, font: { size: 15 } },
      xaxis: { ...axisTitle(xCol) },
      yaxis: { ...axisTitle(`${aggLabel} of ${yCol}`) },
    },
  };
}

function buildScatter(data, xCol, yCol, colorCol, title) {
  const sharedLayout = {
    ...BASE_LAYOUT,
    title: { text: title, font: { size: 15 } },
    xaxis: { ...axisTitle(xCol) },
    yaxis: { ...axisTitle(yCol) },
  };

  if (colorCol) {
    const colorGroups = {};
    for (const row of data) {
      const key = String(row[colorCol]);
      if (!colorGroups[key]) colorGroups[key] = { x: [], y: [] };
      colorGroups[key].x.push(row[xCol]);
      colorGroups[key].y.push(row[yCol]);
    }

    const traces = Object.entries(colorGroups).map(([groupName, vals]) => ({
      type: 'scatter',
      mode: 'markers',
      name: groupName,
      x: vals.x,
      y: vals.y,
      marker: { opacity: 0.7 },
    }));

    return {
      data: traces,
      layout: { ...sharedLayout, legend: { title: { text: colorCol } } },
    };
  }

  return {
    data: [{
      type: 'scatter',
      mode: 'markers',
      x: data.map((r) => r[xCol]),
      y: data.map((r) => r[yCol]),
      marker: { color: ACCENT, opacity: 0.6 },
    }],
    layout: sharedLayout,
  };
}

function buildHistogram(data, xCol, title) {
  return {
    data: [{
      type: 'histogram',
      x: data.map((r) => r[xCol]),
      marker: { color: ACCENT, opacity: 0.8 },
      autobinx: true,
    }],
    layout: {
      ...BASE_LAYOUT,
      title: { text: title, font: { size: 15 } },
      xaxis: { ...axisTitle(xCol) },
      yaxis: { ...axisTitle('Count') },
    },
  };
}

function buildBox(data, xCol, yCol, title) {
  const groups = {};
  for (const row of data) {
    const key = String(row[xCol]);
    const val = Number(row[yCol]);
    if (!isNaN(val)) {
      if (!groups[key]) groups[key] = [];
      groups[key].push(val);
    }
  }

  const traces = Object.entries(groups).map(([groupName, vals]) => ({
    type: 'box',
    name: groupName,
    y: vals,
    boxmean: true,
  }));

  return {
    data: traces,
    layout: {
      ...BASE_LAYOUT,
      title: { text: title, font: { size: 15 } },
      xaxis: { ...axisTitle(xCol) },
      yaxis: { ...axisTitle(yCol) },
    },
  };
}

export function buildPlotlyFigure(graph, data) {
  const { type, title, x, y, color, agg } = graph;

  switch (type) {
    case 'bar':       return buildBar(data, x, y, agg, title);
    case 'scatter':   return buildScatter(data, x, y, color, title);
    case 'histogram': return buildHistogram(data, x, title);
    case 'box':       return buildBox(data, x, y, title);
    default:          return buildHistogram(data, x, title);
  }
}
