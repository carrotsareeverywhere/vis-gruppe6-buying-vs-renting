(function () {
    'use strict';

    const TENURE_KEYS = [
        'hauseigentum', 'wohnungseigentum', 'gemeindewohnung',
        'genossenschaftswohnung', 'andere_hauptmiete', 'sonstige'
    ];

    const TENURE_LABELS = {
        hauseigentum: 'Owned House',
        wohnungseigentum: 'Owned Flat',
        gemeindewohnung: 'Municipal Housing',
        genossenschaftswohnung: 'Co-operative',
        andere_hauptmiete: 'Private Rental',
        sonstige: 'Other'
    };

    const GROUP_COLOR_MAP = {
        'Single-family': '#c62828',
        'Multi-family': '#2e7d32',
        'Single-person': '#1565c0',
        'Multi-person (Non-fam)': '#e65100'
    };

    const NODE_DESCRIPTIONS = {
        'Single-family': 'Couples or single parents, with or without children.',
        'Multi-family': 'Multiple family units sharing one household (typically 5+ persons).',
        'Single-person': 'One person living alone, broken down by age group.',
        'Multi-person (Non-fam)': 'Unrelated persons sharing a household, e.g. flatmates or students.',
        'Couple, no children': 'Two-adult household with no dependent children.',
        'Couple with children': 'Two adults living with one or more dependent children.',
        'Single mother': 'Mother raising dependent children without a partner.',
        'Single father': 'Father raising dependent children without a partner.',
        'Under 30': 'Young adults living alone, aged under 30.',
        '30–59': 'Working-age adults living alone (30–59 years).',
        '60+': 'Older adults living alone, predominantly retirees.',
        'Owned House': 'Occupant owns the single-family dwelling outright.',
        'Owned Flat': 'Occupant owns their condominium or apartment (Eigentumswohnung).',
        'Municipal Housing': 'Subsidised rental from the municipality (Gemeindewohnung).',
        'Co-operative': 'Rental from a housing co-operative at regulated rents.',
        'Private Rental': 'Rented on the private market at market rates.',
        'Other': 'Other tenure arrangements (sub-tenants, rent-free, etc.).',
    };

    function buildChildren(group) {
        return TENURE_KEYS
            .map(key => ({
                name: TENURE_LABELS[key],
                tenureKey: key,
                value: group[key] != null
                    ? (group[key] / 100) * group.insgesamt_in_1000
                    : 0
            }))
            .filter(d => d.value > 0);
    }

    function buildDetailData(data) {
        const fam = data.kategorien['Familienhaushalte'];
        const nfam = data.kategorien['Nichtfamilienhaushalte'];
        const findCat = (arr, label) => arr.find(d => d.label === label);
        const findSub = (parent, label) => parent.unterkategorien.find(d => d.label === label);

        const einfam = findCat(fam, 'Einfamilienhaushalte');
        const mehrfam = findCat(fam, 'Mehrfamilienhaushalte');
        const einperson = findCat(nfam, 'Einpersonenhaushalte');
        const mehrperson = findCat(nfam, 'Mehrpersonen-Nichtfamilienhaushalte');

        return {
            name: 'Austria',
            children: [
                {
                    name: 'Single-family',
                    children: [
                        {
                            name: 'Couple, no children',
                            children: buildChildren(findSub(einfam, '(Ehe-)Paar ohne Kind(-er)'))
                        },
                        {
                            name: 'Couple with children',
                            children: buildChildren(findSub(einfam, '(Ehe-)Paar mit Kind(-ern)'))
                        },
                        {name: 'Single mother', children: buildChildren(findSub(einfam, 'Mutter mit Kind(-ern)'))},
                        {name: 'Single father', children: buildChildren(findSub(einfam, 'Vater mit Kind(-ern)'))}
                    ]
                },
                {
                    name: 'Multi-family',
                    children: [
                        {name: 'Multi-family', isPassthrough: true, children: buildChildren(mehrfam)}
                    ]
                },
                {
                    name: 'Single-person',
                    children: [
                        {name: 'Under 30', children: buildChildren(findSub(einperson, 'bis unter 30 Jahre'))},
                        {name: '30–59', children: buildChildren(findSub(einperson, '30 bis unter 60 Jahre'))},
                        {name: '60+', children: buildChildren(findSub(einperson, '60 und mehr Jahre'))}
                    ]
                },
                {
                    name: 'Multi-person (Non-fam)',
                    children: [
                        {name: 'Multi-person (Non-fam)', isPassthrough: true, children: buildChildren(mehrperson)}
                    ]
                }
            ]
        };
    }

    function renderSunburst(selector, hierarchyData) {
        const container = document.querySelector(selector);
        if (!container) return;

        const W = container.clientWidth;
        const H = container.clientHeight;
        const radius = Math.min(W, H) / 2 * 0.9;

        const svg = d3.select(selector).append('svg').attr('width', W).attr('height', H);
        const g = svg.append('g').attr('transform', `translate(${W / 2},${H / 2})`);

        const root = d3.hierarchy(hierarchyData)
            .sum(d => d.value || 0)
            .sort((a, b) => b.value - a.value);

        d3.partition().size([2 * Math.PI, radius])(root);

        // Extend depth-3 children of pass-through nodes inward to fill the empty middle ring
        root.each(d => {
            if (d.depth === 3 && d.parent.data.isPassthrough) d.y0 = d.parent.y0;
        });

        root.each(d => d.current = {x0: d.x0, x1: d.x1, y0: d.y0, y1: d.y1});

        const arc = d3.arc()
            .startAngle(d => d.x0)
            .endAngle(d => d.x1)
            .padAngle(d => Math.min((d.x1 - d.x0) / 2, 0.004))
            .padRadius(radius * 0.5)
            .innerRadius(d => d.y0)
            .outerRadius(d => Math.max(d.y0, d.y1 - 1));

        function groupAncestorColor(d) {
            let n = d;
            while (n.depth > 1) n = n.parent;
            return GROUP_COLOR_MAP[n.data.name] || '#999';
        }

        function getColor(d) {
            const baseHex = groupAncestorColor(d);
            if (d.depth === 1) return baseHex;
            if (d.data.tenureKey) {
                const hsl = d3.hsl(baseHex);
                const idx = TENURE_KEYS.indexOf(d.data.tenureKey);
                hsl.l = d.depth === 2
                    ? 0.75 - (idx / (TENURE_KEYS.length - 1)) * 0.45
                    : 0.72 - (idx / (TENURE_KEYS.length - 1)) * 0.24;
                return hsl + '';
            }
            if (d.data.isPassthrough) return 'none';
            const hsl = d3.hsl(baseHex);
            hsl.l = 0.40;
            hsl.s = Math.max(hsl.s * 0.80, 0.35);
            return hsl + '';
        }

        const tooltipEl = document.getElementById('sunburst-tooltip');

        const paths = g.selectAll('path')
            .data(root.descendants().filter(d => d.depth > 0))
            .join('path')
            .attr('d', d => arc(d.current))
            .attr('fill', getColor)
            .attr('stroke', d => d.data.isPassthrough ? 'none' : '#fff')
            .attr('stroke-width', 1.5)
            .style('pointer-events', d => d.data.isPassthrough ? 'none' : null)
            .style('cursor', d => d.depth === 1 ? 'pointer' : 'default')
            .on('mousemove', function (event, d) {
                const abs = d.value.toFixed(1);
                const pctAll = ((d.value / root.value) * 100).toFixed(1);
                const desc = NODE_DESCRIPTIONS[d.data.name] || '';
                const descHtml = desc
                    ? `<span style="font-size:0.82em;opacity:0.82;display:block;margin-top:3px">${desc}</span>`
                    : '';
                let html;
                if (d.depth === 1) {
                    html = `<strong>${d.data.name}</strong>${descHtml}`
                        + `<hr style="margin:4px 0;border-color:#555">`
                        + `${abs}k households &nbsp;·&nbsp; ${pctAll}% of all households`;
                } else if (d.depth === 2) {
                    const pctParent = ((d.value / d.parent.value) * 100).toFixed(1);
                    html = `<strong>${d.data.name}</strong> <span style="opacity:0.65;font-size:0.85em">in ${d.parent.data.name}</span>${descHtml}`
                        + `<hr style="margin:4px 0;border-color:#555">`
                        + `${abs}k households &nbsp;·&nbsp; ${pctParent}% of ${d.parent.data.name} &nbsp;·&nbsp; ${pctAll}% of all households`;
                } else {
                    const pctParent = ((d.value / d.parent.value) * 100).toFixed(1);
                    html = `<strong>${d.data.name}</strong> <span style="opacity:0.65;font-size:0.85em">in ${d.parent.data.name} › ${d.parent.parent.data.name}</span>${descHtml}`
                        + `<hr style="margin:4px 0;border-color:#555">`
                        + `${abs}k households &nbsp;·&nbsp; ${pctParent}% of subgroup &nbsp;·&nbsp; ${pctAll}% of all households`;
                }
                tooltipEl.innerHTML = html;
                tooltipEl.style.opacity = '1';
                tooltipEl.style.left = (event.clientX + 14) + 'px';
                tooltipEl.style.top = (event.clientY - 40) + 'px';
                d3.select(this).attr('opacity', 0.75);
            })
            .on('mouseleave', function () {
                tooltipEl.style.opacity = '0';
                d3.select(this).attr('opacity', 1);
            })
            .on('click', (event, d) => {
                if (d.depth !== 1) return;
                zoom(currentFocus === d ? root : d);
            });

        const centerG = g.append('g').style('cursor', 'pointer').on('click', () => zoom(root));
        centerG.append('text')
            .attr('text-anchor', 'middle').attr('y', -7)
            .attr('font-size', '11px').attr('font-weight', '700').attr('fill', '#ae0000')
            .text('Austria');
        centerG.append('text')
            .attr('text-anchor', 'middle').attr('y', 9)
            .attr('font-size', '9px').attr('fill', '#777')
            .text((root.value / 1000).toFixed(2) + 'M households');

        const UPPER_START = -Math.PI / 2;
        const LOWER_START = Math.PI / 2;
        const HALF = Math.PI;
        let currentFocus = root;

        function zoom(focus) {
            currentFocus = focus;

            if (focus === root) {
                root.descendants().filter(d => d.depth > 0).forEach(d => {
                    d.target = {x0: d.x0, x1: d.x1, y0: d.y0, y1: d.y1};
                });
            } else {
                const focusSpan = focus.x1 - focus.x0;
                const otherSpan = 2 * Math.PI - focusSpan;
                const remapOther = x => x <= focus.x0 ? x : x - focusSpan;

                root.children.forEach(d => {
                    if (d === focus) {
                        d.target = {x0: UPPER_START, x1: UPPER_START + HALF, y0: d.y0, y1: d.y1};
                    } else {
                        const s = remapOther(d.x0) / otherSpan;
                        const e = remapOther(d.x1) / otherSpan;
                        d.target = {x0: LOWER_START + s * HALF, x1: LOWER_START + e * HALF, y0: d.y0, y1: d.y1};
                    }
                });

                function propagate(node) {
                    if (!node.children) return;
                    const origSpan = node.x1 - node.x0;
                    const newSpan = node.target.x1 - node.target.x0;
                    node.children.forEach(child => {
                        const rel0 = (child.x0 - node.x0) / origSpan;
                        const rel1 = (child.x1 - node.x0) / origSpan;
                        child.target = {
                            x0: node.target.x0 + rel0 * newSpan,
                            x1: node.target.x0 + rel1 * newSpan,
                            y0: child.y0, y1: child.y1
                        };
                        propagate(child);
                    });
                }

                root.children.forEach(propagate);
            }

            const t = g.transition().duration(650).ease(d3.easeCubicInOut);
            paths.transition(t).attrTween('d', d => {
                const i = d3.interpolate(d.current, d.target);
                return t => arc(d.current = i(t));
            });
        }

        container.zoomByName = name => {
            const node = root.children.find(d => d.data.name === name);
            if (node) zoom(currentFocus === node ? root : node);
        };
    }

    // Public API
    window.buildSunburstData = buildDetailData;
    window.renderSunburst = renderSunburst;

})();