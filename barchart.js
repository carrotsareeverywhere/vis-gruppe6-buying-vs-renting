document.addEventListener("DOMContentLoaded", () => {

    // D3 Stacked Bar Chart
    const keys = ["mortgage_rent", "operating", "energy", "misc"];
    const keyLabels = {
        "mortgage_rent": "Mortgage / Rent",
        "operating": "Operating Costs",
        "energy": "Energy",
        "misc": "Miscellaneous",
    };
    const colors = ["#648FFF", "#FFB000", "#FE6100", "#DC267F"];

    const tooltip = d3.select("#barchart-tooltip");
    const margin = { top: 20, right: 150, bottom: 45, left: 85 };
    const width = 600 - margin.left - margin.right;
    const height = 300 - margin.top - margin.bottom;

    const svg = d3.select("#barchart-canvas")
        .append("svg")
        .attr("viewBox", `0 0 ${width + margin.left + margin.right} ${height + margin.top + margin.bottom}`)
        .attr("width", "100%")
        .attr("height", "100%")
        .append("g")
        .attr("transform", `translate(${margin.left},${margin.top})`);


    d3.json("data.json").then(rawData => {
        function updateChart() {
            const selectedIDs = Array.from(document.querySelectorAll('.type-toggle:checked')).map(cb => cb.value);
            const housingData = rawData.filter(d => selectedIDs.includes(d.id));

            svg.selectAll("*").remove();
            if (housingData.length === 0) return;

            const x = d3.scaleBand().domain(housingData.map(d => d.type)).range([0, width]).padding(0.3);
            const maxY = d3.max(housingData, d => keys.reduce((sum, key) => sum + (d[key] || 0), 0));
            const y = d3.scaleLinear().domain([0, Math.ceil(maxY / 100) * 100]).range([height, 0]);
            const color = d3.scaleOrdinal().domain(keys).range(colors);
            const stackedData = d3.stack().keys(keys)(housingData);

            svg.append("g")
                .call(d3.axisLeft(y).ticks(6).tickFormat(d => `€${d}`))
                .call(g => g.select(".domain").remove())
                .call(g => g.selectAll(".tick line").attr("x2", width).attr("stroke-opacity", 0.5).attr("stroke-dasharray", "2,2"));

            svg.append("text").attr("class", "axis-label").attr("text-anchor", "end").attr("transform", "rotate(-90)").attr("y", -margin.left + 25).attr("x", 0).text("Monthly Costs in €");

            const xAxis = svg.append("g").attr("transform", `translate(0,${height})`).call(d3.axisBottom(x));
            xAxis.selectAll(".tick text").style("font-size", "10px").style("font-weight", "600").style("fill", "#333");

            svg.append("text").attr("class", "axis-label").attr("text-anchor", "end").attr("x", width).attr("y", height + margin.bottom - 5).text("Type of Housing");

            const defs = svg.append("defs");
            const clipRects = defs.selectAll("clipPath").data(housingData).enter().append("clipPath").attr("id", (d, i) => `clip-${i}`).append("rect").attr("x", d => x(d.type)).attr("y", height).attr("width", x.bandwidth()).attr("height", 0);

            clipRects.transition().duration(1200).ease(d3.easeCubicOut).delay((d, i) => i * 150).attr("y", 0).attr("height", height);

            const layer = svg.selectAll(".layer").data(stackedData).enter().append("g").attr("class", "layer").attr("fill", d => color(d.key));

            const rects = layer.selectAll("rect").data(d => d).enter().append("rect").attr("x", d => x(d.data.type)).attr("y", d => y(d[1])).attr("height", d => Math.max(0, y(d[0]) - y(d[1]))).attr("width", x.bandwidth()).attr("rx", 2).attr("clip-path", (d, i) => `url(#clip-${i})`);

            rects.on("mouseover", function(event, d) {
                d3.selectAll("rect").style("opacity", 0.3);
                d3.select(this).style("opacity", 1).style("stroke", "#ae0000").style("stroke-width", 2);

                const componentName = d3.select(this.parentNode).datum().key;
                const componentValue = d[1] - d[0];
                const totalValue = keys.reduce((sum, k) => sum + (d.data[k] || 0), 0);

                tooltip.html(`
                    <div class="tooltip-title">${d.data.type}</div>
                    <div class="tooltip-row">
                        <span>${keyLabels[componentName]}:</span>
                        <span class="tooltip-value" style="color: ${color(componentName)}">€${componentValue.toFixed(2)}</span>
                    </div>
                    <div class="tooltip-row" style="margin-top: 10px; border-top: 1px dashed #dcdfe6; padding-top: 8px;">
                        <span>Total Monthly Cost:</span>
                        <span class="tooltip-value" style="color: #ae0000">€${totalValue.toFixed(2)}</span>
                    </div>
                `);
                tooltip.style("opacity", 1);
            }).on("mousemove", function(event) {
                tooltip.style("left", (event.pageX) + "px").style("top", (event.pageY) + "px");
            }).on("mouseout", function() {
                d3.selectAll("rect").style("opacity", 1).style("stroke", "none");
                tooltip.style("opacity", 0);
            });

            const legend = svg.append("g").attr("transform", `translate(${width + 20}, 20)`);
            const legendKeys = [...keys].reverse();

            legendKeys.forEach((key, i) => {
                const legendRow = legend.append("g").attr("transform", `translate(0, ${i * 28})`);
                legendRow.append("rect").attr("width", 14).attr("height", 14).attr("rx", 2).attr("fill", color(key));
                legendRow.append("text").attr("x", 22).attr("y", 11).style("font-size", "12px").style("fill", "#555").style("font-weight", "600").text(keyLabels[key]);
            });
        }

        document.querySelectorAll('.type-toggle').forEach(checkbox => {
            checkbox.addEventListener('change', updateChart);
        });

        updateChart();
    }).catch(error => console.error("Error loading the data: ", error));

    // Cost Estimator Logic
    const typeSelect = document.getElementById("calc-type");
    const sizeSlider = document.getElementById("calc-slider");
    const sizeNumber = document.getElementById("calc-number");
    const resultValue = document.getElementById("calc-result");
    const resultFormula = document.getElementById("calc-formula");

    const sqmRates = { "house_owner": 4.1, "apt_owner": 7.3, "municipal": 11.1, "cooperative": 11.8, "other_rent": 14.5 };

    function calculateCost() {
        const selectedType = typeSelect.value;
        const ratePerSqm = sqmRates[selectedType] || 0;
        let size = parseFloat(sizeNumber.value);

        if (isNaN(size) || size < 0) size = 0;
        const totalCost = ratePerSqm * size;

        resultValue.textContent = `€${totalCost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        resultFormula.textContent = `${size} m² × ${ratePerSqm.toFixed(1)} €/m²`;
    }

    typeSelect.addEventListener("change", calculateCost);
    sizeSlider.addEventListener("input", (e) => { sizeNumber.value = e.target.value; calculateCost(); });
    sizeNumber.addEventListener("input", (e) => {
        let val = parseFloat(e.target.value);
        if (!isNaN(val) && val >= 20 && val <= 300) sizeSlider.value = val;
        calculateCost();
    });

    calculateCost();
});