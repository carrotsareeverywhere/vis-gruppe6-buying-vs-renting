(function () {
    'use strict';

    // FMA rule: annual debt service ≤ 40 % of annual net income (incl. 13./14. Gehalt)
    // Source: FMA-Rundschreiben – Solide Vergabe von privaten Wohnimmobilienkrediten, 26 Jun 2025
    // Note: calculation uses household income only — not a credit decision.

    const MORTGAGE_RATE = 0.035; // typical Austrian rate 2024/25

    function annualMortgagePayment(loan, termYears) {
        const r = MORTGAGE_RATE, n = termYears;
        return loan * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1);
    }

    // Linear interpolation of empirical CDF from percentile points [[income, pct], ...]
    // Returns fraction of households with income ≤ x (extrapolates linearly outside p10–p90)
    function cdfAt(pts, x) {
        if (x <= 0) return 0;
        if (x <= pts[0][0]) return pts[0][1] * (x / pts[0][0]);
        const last = pts[pts.length - 1], prev = pts[pts.length - 2];
        if (x >= last[0]) {
            const slope = (last[1] - prev[1]) / (last[0] - prev[0]);
            return Math.min(last[1] + slope * (x - last[0]), 1);
        }
        for (let i = 1; i < pts.length; i++) {
            if (x <= pts[i][0]) {
                const t = (x - pts[i - 1][0]) / (pts[i][0] - pts[i - 1][0]);
                return pts[i - 1][1] + t * (pts[i][1] - pts[i - 1][1]);
            }
        }
        return 1;
    }

    // Converts one row from verfuegbares_einkommen_haushalte.json into the chart group format
    function rowToIncomeGroup(name, color, row) {
        return {
            name,
            color,
            pts: [
                [row.einkommen_10_perzentil, 0.10],
                [row.einkommen_25_perzentil, 0.25],
                [row.einkommen_50_perzentil_median, 0.50],
                [row.einkommen_75_perzentil, 0.75],
                [row.einkommen_90_perzentil, 0.90],
            ],
            mean: row.einkommen_arithmetisches_mittel
        };
    }

    function buildIncomeGroups(einkommen) {
        const hg = einkommen.kategorien['Haushaltsgröße'].haushaltstypen;
        const ohp = einkommen.kategorien['Haushalte ohne Pension'].haushaltstypen;
        const mk = einkommen.kategorien['Haushalte mit Kindern'];
        const find = (arr, label) => arr.find(d => d.label === label);
        return [
            rowToIncomeGroup('Single-person', '#1565c0', find(hg, '1 Person')),
            rowToIncomeGroup('Multi-person, no children', '#e65100', find(ohp, 'Mehrpersonenhaushalt ohne Kinder')),
            rowToIncomeGroup('Multi-person with children', '#c62828', mk.summe),
            rowToIncomeGroup('Multi-family (5+ persons)', '#2e7d32', find(hg, '5 und mehr Personen')),
        ];
    }

    function renderIncomeChart(selector, incomeGroups) {
        const container = document.querySelector(selector);
        if (!container) return;

        // Pre-populate results so the input section reaches its final height before we measure
        const inputEl = document.getElementById('loan-input');
        const resultsEl = document.getElementById('loan-results');
        if (inputEl && !inputEl.value) inputEl.value = 300000;
        const defaultLoan = inputEl ? +inputEl.value : 300000;
        if (resultsEl && defaultLoan > 0) {
            const minInc = annualMortgagePayment(defaultLoan, 30) / 0.40;
            resultsEl.innerHTML = incomeGroups.map(grp => {
                const pctCan = Math.round((1 - cdfAt(grp.pts, minInc)) * 100);
                return `<span class="afford-row">
                    <span class="afford-swatch" style="background:${grp.color}"></span>
                    <span class="afford-name">${grp.name}:</span>
                    <span class="afford-pct" style="color:${grp.color}">~${pctCan}%</span>
                </span>`;
            }).join('');
        }

        // Expose _update immediately so oninput works before the rAF fires
        container._update = loanAmount => {
            if (container._realUpdate) container._realUpdate(loanAmount);
        };

        // Defer chart creation one frame so flex layout settles with results in the DOM
        requestAnimationFrame(() => {
            const margin = {top: 22, right: 70, bottom: 44, left: 148};
            const W = container.clientWidth;
            const H = Math.max(container.clientHeight, 160);
            const cW = W - margin.left - margin.right;
            const cH = H - margin.top - margin.bottom;
            if (cW <= 0 || cH <= 0) return;

            const svg = d3.select(selector).append('svg').attr('width', W).attr('height', H);
            const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

            const X_MAX = 170000;
            const xScale = d3.scaleLinear().domain([0, X_MAX]).range([0, cW]);
            const yScale = d3.scaleBand()
                .domain(incomeGroups.map(d => d.name))
                .range([0, cH])
                .padding(0.38);

            // Vertical grid lines
            g.append('g').attr('transform', `translate(0,${cH})`)
                .call(d3.axisBottom(xScale).ticks(6).tickSize(-cH).tickFormat(''))
                .call(gg => {
                    gg.selectAll('line').attr('stroke', '#ebebeb').attr('stroke-dasharray', '3 3');
                    gg.select('.domain').remove();
                });

            // Axes
            g.append('g').attr('transform', `translate(0,${cH})`)
                .call(d3.axisBottom(xScale).ticks(6)
                    .tickFormat(d => d === 0 ? '' : `€${d / 1000}k`));
            g.append('g').call(d3.axisLeft(yScale).tickSize(0))
                .call(gg => gg.select('.domain').remove())
                .selectAll('text')
                .attr('font-size', '10px').attr('fill', '#444').attr('font-weight', '600');

            // X-axis label + legend
            g.append('text').attr('text-anchor', 'middle')
                .attr('x', cW / 2).attr('y', cH + 38)
                .attr('font-size', '10px').attr('fill', '#666')
                .text('Annual net household income (EUR)  ·  box: P25–P75  |  whiskers: P10–P90  |  │ median');

            // Boxplot per group
            incomeGroups.forEach(grp => {
                const y = yScale(grp.name);
                const bH = yScale.bandwidth();
                const mid = y + bH / 2;
                const p10 = grp.pts[0][0], p25 = grp.pts[1][0],
                    p50 = grp.pts[2][0], p75 = grp.pts[3][0], p90 = grp.pts[4][0];

                // Whisker line p10 → p90
                const capH = bH * 0.28;
                g.append('line')
                    .attr('x1', xScale(p10)).attr('x2', xScale(p90))
                    .attr('y1', mid).attr('y2', mid)
                    .attr('stroke', grp.color).attr('stroke-width', 1.5).attr('opacity', 0.7);
                [p10, p90].forEach(x => {
                    g.append('line')
                        .attr('x1', xScale(x)).attr('x2', xScale(x))
                        .attr('y1', mid - capH).attr('y2', mid + capH)
                        .attr('stroke', grp.color).attr('stroke-width', 1.5).attr('opacity', 0.7);
                });

                // IQR box p25 → p75
                const boxH = bH * 0.55;
                g.append('rect')
                    .attr('x', xScale(p25)).attr('y', mid - boxH / 2)
                    .attr('width', xScale(p75) - xScale(p25)).attr('height', boxH)
                    .attr('fill', grp.color).attr('opacity', 0.45)
                    .attr('rx', 2).attr('stroke', grp.color).attr('stroke-width', 1);

                // Median tick
                g.append('line')
                    .attr('x1', xScale(p50)).attr('x2', xScale(p50))
                    .attr('y1', mid - boxH / 2).attr('y2', mid + boxH / 2)
                    .attr('stroke', '#fff').attr('stroke-width', 2);
            });

            // FMA threshold line + label (updated on loan input)
            const threshLine = g.append('line')
                .attr('y1', 0).attr('y2', cH)
                .attr('stroke', '#222').attr('stroke-width', 1.5)
                .attr('stroke-dasharray', '6 3')
                .style('opacity', 0);
            const threshLabel = g.append('text')
                .attr('text-anchor', 'middle').attr('font-size', '9px').attr('fill', '#222')
                .style('opacity', 0);

            const resultsElInner = document.getElementById('loan-results');

            function update(loanAmount) {
                if (!loanAmount || loanAmount <= 0) {
                    threshLine.style('opacity', 0);
                    threshLabel.style('opacity', 0);
                    if (resultsElInner) resultsElInner.innerHTML = '';
                    return;
                }
                const minInc = annualMortgagePayment(loanAmount, 30) / 0.40;
                const xPos = xScale(minInc);
                threshLine.attr('x1', xPos).attr('x2', xPos).style('opacity', 1);
                threshLabel
                    .attr('x', xPos).attr('y', -6)
                    .text(`€${Math.round(minInc / 100) * 100}/yr`)
                    .style('opacity', 1);
                if (resultsElInner) {
                    resultsElInner.innerHTML = incomeGroups.map(grp => {
                        const pctCan = Math.round((1 - cdfAt(grp.pts, minInc)) * 100);
                        return `<span class="afford-row">
                            <span class="afford-swatch" style="background:${grp.color}"></span>
                            <span class="afford-name">${grp.name}:</span>
                            <span class="afford-pct" style="color:${grp.color}">~${pctCan}%</span>
                        </span>`;
                    }).join('');
                }
            }

            // Hairline — appended after threshold line so it renders on top
            const hairLine = g.append('line')
                .attr('y1', 0).attr('y2', cH)
                .attr('stroke', '#555').attr('stroke-width', 1)
                .attr('stroke-dasharray', '4 3')
                .style('opacity', 0).style('pointer-events', 'none');
            const hairLabelBg = g.append('rect')
                .attr('fill', '#fff').attr('stroke', '#ccc').attr('stroke-width', 1).attr('rx', 3)
                .style('opacity', 0).style('pointer-events', 'none');
            const hairLabel = g.append('text')
                .attr('y', 16).attr('font-size', '10px').attr('text-anchor', 'middle')
                .attr('fill', '#333').attr('font-weight', '600')
                .style('opacity', 0).style('pointer-events', 'none');

            g.append('rect')
                .attr('width', cW).attr('height', cH)
                .attr('fill', 'none').style('pointer-events', 'all')
                .on('mousemove', function (event) {
                    const [mx] = d3.pointer(event);
                    if (mx < 0 || mx > cW) return;
                    const label = `€${(Math.max(0, xScale.invert(mx)) / 1000).toFixed(1)}k`;
                    hairLine.attr('x1', mx).attr('x2', mx).style('opacity', 1);
                    hairLabel.attr('x', mx).text(label).style('opacity', 1);
                    const bb = hairLabel.node().getBBox();
                    hairLabelBg
                        .attr('x', bb.x - 5).attr('y', bb.y - 3)
                        .attr('width', bb.width + 10).attr('height', bb.height + 6)
                        .style('opacity', 1);
                })
                .on('mouseleave', function () {
                    hairLine.style('opacity', 0);
                    hairLabel.style('opacity', 0);
                    hairLabelBg.style('opacity', 0);
                });

            update(defaultLoan);
            container._realUpdate = update;
            container._update = update;
        });
    }

    // Public API
    window.buildIncomeGroups = buildIncomeGroups;
    window.renderIncomeChart = renderIncomeChart;

})();