// Global Configuration Defaults
const fallbackDefaultEconomics = {
    purchasePricePerM2: 3412,  // Standard fallback purchase price
    rentPricePerM2: 12.20         // Standard fallback rent price
};

// Mapping of ISO codes to State Names for display in District View
const stateIsoMap = {
    "1": "Burgenland",
    "2": "Kärnten",
    "3": "Niederösterreich",
    "4": "Oberösterreich",
    "5": "Salzburg",
    "6": "Steiermark",
    "7": "Tirol",
    "8": "Vorarlberg",
    "9": "Wien"
};

let austrianStatesGeoJSON = null;
let austrianDistrictsGeoJSON = null;
let minKaufpreis = Infinity, maxKaufpreis = 0;
let minMiete = Infinity, maxMiete = 0;
let kaufpreisThresholds = [];
let mieteThresholds = [];

let buySize, rentSize, monthlyIncome, downPayment, inputPriceM2, inputLoanAmount, inputLoanRepayment, monthlyRent, rentDeposit, userRentIncreaseRate, avgMonthlyExpenses;

async function loadGeoJsonFiles() {
    try {
        const statesResponse = await fetch('laender_95_geo_mit_Preisen.json');
        const districtsResponse = await fetch('bezirke_95_geo_mit_Kaufpreis_2025_v2.json');

        if (!statesResponse.ok || !districtsResponse.ok) {
            throw new Error(`HTTP error! Status: ${statesResponse.status} / ${districtsResponse.status}`);
        }

        austrianStatesGeoJSON = await statesResponse.json();
        austrianDistrictsGeoJSON = await districtsResponse.json();

        console.log("GeoJSON data arrays successfully mounted.");

        loadMapData(currentLayerType);
        calculateQuantileThresholds(austrianDistrictsGeoJSON);
        updateLegendLabels(currentColorMetric);
        switchColorMetric('Kaufpreis');

    } catch (error) {
        console.error("Critical error loading the GeoJSON files:", error);

        // UI fallback warning directly on the map block container
        const mapEl = document.getElementById('map');
        if (mapEl) {
            mapEl.innerHTML = `<div style="padding: 20px; color: #ae0000; font-weight: bold; text-align: center;">
                Failed to load regional data files. Please ensure you are running a local web server (e.g., Live Server) and the filenames match.
            </div>`;
        }
    }
}

function calculateQuantileThresholds(geoJSONData) {
    const features = geoJSONData.features || [];

    // Extract and sort all valid values from the dataset
    let kaufpreisArray = features
        .map(f => parseFloat(f.properties.Kaufpreis))
        .filter(v => !isNaN(v) && v > 0)
        .sort((a, b) => a - b);

    let mieteArray = features
        .map(f => parseFloat(f.properties.miete))
        .filter(v => !isNaN(v) && v > 0)
        .sort((a, b) => a - b);

    const steps = 11;
    kaufpreisThresholds = [];
    mieteThresholds = [];

    // Find the exact boundaries for 11 equal-sized buckets
    for (let i = 1; i < steps; i++) {
        let percentileIdx = Math.floor((i / steps) * kaufpreisArray.length);
        kaufpreisThresholds.push(kaufpreisArray[percentileIdx]);

        let mietePercentileIdx = Math.floor((i / steps) * mieteArray.length);
        mieteThresholds.push(mieteArray[mietePercentileIdx]);
    }
}

// Application Orchestration Handles
let map;
let geojsonLayer;
let currentLayerType = 'states';
let currentColorMetric = 'Kaufpreis';
let activeSelectedProperties = null;
let breakEvenChartInstance = null;
let isCalculationTriggered = false;

function extractNumericValue(val) {
    if (val === undefined || val === null) return 0;
    if (typeof val === 'number') return val;
    // Replace German decimals if necessary and clean string
    let cleaned = val.toString().replace(/\./g, '').replace(',', '.');
    return parseFloat(cleaned) || 0;
}

function getColorForValue(value, metric) {
    if (!value || value === 0) return '#b0b0b0'; // Grey if no data is available

    // Array of 11 distinct colors transitioning from Green -> Yellow -> Red
    const colorPalette = [
        "#0B3D0B",
        "#1E5A1E",
        "#3F7F1F",
        "#7DAA22",
        "#C7D83A",
        "#FFD700",
        "#F4B000",
        "#E68400",
        "#D4551A",
        "#B22222",
        "#7A0000"
    ];

    const thresholds = (metric === 'Kaufpreis') ? kaufpreisThresholds : mieteThresholds;

    let bucket = 0;
    while (bucket < thresholds.length && value > thresholds[bucket]) {
        bucket++;
    }

    return colorPalette[bucket];
}

function styleFeature(feature) {
    const props = feature.properties;

    const activeMetric = (typeof currentColorMetric !== 'undefined') ? currentColorMetric : 'Kaufpreis';

    const rawValue = props[activeMetric];
    const numericValue = extractNumericValue(rawValue);

    const fillColor = getColorForValue(numericValue, activeMetric);

    return {
        fillColor: fillColor,
        weight: 1.5,
        opacity: 1,
        color: '#ffffff', // Border color between districts/states
        fillOpacity: currentLayerType === 'states' ? 0.65 : 0.75
    };
}

function onEachFeature(feature, layer) {
    layer.on({
        mouseover: (e) => { e.target.setStyle({ fillOpacity: 0.9, weight: 2.5 }); },
        mouseout: (e) => { geojsonLayer.resetStyle(e.target); },
        click: (e) => {
            const props = feature.properties;
            activeSelectedProperties = props;
            const contentDiv = document.getElementById('info-content');
            if (!contentDiv) return;

            if (currentLayerType === 'states') {
                contentDiv.innerHTML = `
                    <div class="data-card">
                        <h3>${props.name || 'Unknown Province'}</h3>
                        <p style="margin-top: 8px;"><strong>Avg. Kaufpreis:</strong> ${props.Kaufpreis || 'Data Pending'} (per m²) (€)</p>
                        <p style="margin-top: 4px;"><strong>Avg. Miete:</strong> ${props.miete || 'Data Pending'} (per m²) (€) 
                        <br> <small>Bestandsmieten sind inkl. Betriebskosten laut Statistik Austria</small> 
                        <br> <small>Ausgenommen geförderte Gemeindewohnungen in Wien</small>
                        </p>
                    </div>
                `;
            } else {
                const stateCode = props.iso ? props.iso.substring(0, 1) : '';
                const stateName = stateIsoMap[stateCode] || 'Austria Region';

                contentDiv.innerHTML = `
                    <div class="data-card">
                        <h3>${props.name || 'Unknown District'}</h3>
                        <p style="color: #666; font-size: 0.9rem;">Bundesland: ${stateName}</p>
                        <p style="margin-top: 8px;"><strong>Kaufpreis:</strong> ${props.Kaufpreis || 'Data Pending'} (per m²) (€)</p>
                        <p style="margin-top: 4px;"><strong>Miete:</strong> ${props.miete || 'Data Pending'} (per m²) (€)</p>
                    </div>
                `;
            }

            this.parsedKauf = extractNumericValue(props.Kaufpreis);
            this.parsedMiete = extractNumericValue(props.miete);
            let size = parseFloat(document.getElementById("param-rent-size").value) || 80;

            if (this.parsedKauf) document.getElementById("param-price-m2").value = Math.round(this.parsedKauf);
            if (this.parsedMiete) document.getElementById("param-rent").value = Math.round(this.parsedMiete * size);

            calculateBreakEven();
        }
    });
}

function loadMapData(type) {
    if (!map) return;
    if (geojsonLayer) map.removeLayer(geojsonLayer);

    const targetData = (type === 'states') ? austrianStatesGeoJSON : austrianDistrictsGeoJSON;

    geojsonLayer = L.geoJSON(targetData, {
        style: styleFeature,
        onEachFeature: onEachFeature
    }).addTo(map);

    if (geojsonLayer.getLayers().length > 0) {
        map.fitBounds(geojsonLayer.getBounds());
    }
}

function switchLayer(type) {
    currentLayerType = type;
    activeSelectedProperties = null;

    document.getElementById('btn-states').classList.toggle('active', type === 'states');
    document.getElementById('btn-districts').classList.toggle('active', type === 'districts');

    const contentDiv = document.getElementById('info-content');
    if (contentDiv) {
        contentDiv.innerHTML = `
            <p class="placeholder-text">Click directly on any ${type === 'states' ? 'state' : 'district'} within Austria to view details.</p>
        `;
    }
    updateLegendLabels(currentColorMetric);
    loadMapData(type);
    calculateBreakEven();
}

function switchColorMetric(metricName) {
    currentColorMetric = metricName;
    document.getElementById('btn-color-kaufpreis').classList.toggle('active', metricName === 'Kaufpreis');
    document.getElementById('btn-color-miete').classList.toggle('active', metricName === 'miete');

    updateLegendLabels(currentColorMetric);
    loadMapData(currentLayerType);
}

function handleManualRecalculate() {
    isCalculationTriggered = true;
    calculateBreakEven();
    inputExceptionHandler();
}

function toggleChartLineVisibility() {
    if (!breakEvenChartInstance) return;

    const showRenter = document.getElementById('chk-line-renter').checked;
    const showOwner = document.getElementById('chk-line-owner').checked;
    const showCumRent = document.getElementById('chk-line-cum-rent').checked;
    const showCumBuy = document.getElementById('chk-line-cum-buy').checked;

    breakEvenChartInstance.setDatasetVisibility(0, showRenter);
    breakEvenChartInstance.setDatasetVisibility(1, showOwner);
    breakEvenChartInstance.setDatasetVisibility(2, isCalculationTriggered && showCumRent);
    breakEvenChartInstance.setDatasetVisibility(3, isCalculationTriggered && showCumBuy);

    breakEvenChartInstance.update();
}

function updateLegendLabels(metric) {
    const steps = 11;
    const thresholds = (metric === 'Kaufpreis') ? kaufpreisThresholds : mieteThresholds;

    for (let i = 0; i < steps; i++) {
        const labelElement = document.getElementById(`legend-label-${steps - i}`);
        if (!labelElement) continue;

        let labelText = "";

        if (i === 0) {
            // First bucket (Cheapest)
            let upper = thresholds[0];
            labelText = `< ${metric === 'miete' ? upper.toFixed(1) : Math.round(upper)} €`;
        } else if (i === steps - 1) {
            // Last bucket (Most Expensive)
            let lower = thresholds[thresholds.length - 1];
            labelText = `> ${metric === 'miete' ? lower.toFixed(1) : Math.round(lower)} €`;
        } else {
            // Intermediate ranges
            let lower = thresholds[i - 1];
            let upper = thresholds[i];

            if (metric === 'miete') {
                labelText = `${lower.toFixed(1)} € - ${upper.toFixed(1)} €`;
            } else {
                labelText = `${Math.round(lower)} € - ${Math.round(upper)} €`;
            }
        }

        labelElement.textContent = labelText;
    }
}

function calculateBreakEven() {
    const canvasEl = document.getElementById('breakEvenChart');
    if (!canvasEl) return;

    // Extract sizing inputs explicitly
    buySize = parseFloat(document.getElementById("param-buy-size").value) || 80;
    rentSize = parseFloat(document.getElementById("param-rent-size").value) || 80;
    monthlyIncome = parseFloat(document.getElementById("param-income").value) || 4500;
    downPayment = parseFloat(document.getElementById("param-capital").value) || 0;
    inputPriceM2 = parseFloat(document.getElementById("param-price-m2").value) || 0;
    inputLoanAmount = parseFloat(document.getElementById("param-loan-amount").value) || 0;
    inputLoanRepayment = parseFloat(document.getElementById("param-loan-repayment").value) || 0;
    monthlyRent = parseFloat(document.getElementById("param-rent").value) || 0;
    rentDeposit = parseFloat(document.getElementById("param-deposit").value) || 0;
    userRentIncreaseRate = parseFloat(document.getElementById("param-rent-increase").value) || 2.0;
    avgMonthlyExpenses = parseFloat(document.getElementById("param-monthly-expenses").value) || 400;

    // Standard Defaults for Austria based on statistic austria and a few google searches (so take it with a grain of salt)
    const mortgageRate = 0.035;       // 3.5% nominal interest rate
    const mortgageYears = 30;
    const appreciationRate = 0.03;   // 3.0% property value growth
    const rentIncreaseRate = userRentIncreaseRate / 100;
    const maintenanceRate = 0.01;    // 1.0% of property value per year spent on repairs
    const closingCostRate = 0.10;    // 10% (Grunderwerbsteuer, Grundbuch, Makler, Notar)
    const incomeGrowthRate = 0.025;  // 2.5% Standard inflation

    const purchasePrice = inputPriceM2 * buySize;
    const closingCosts = purchasePrice * closingCostRate;
    const totalUpfrontRequired = downPayment + closingCosts;

    let loanAmount = purchasePrice - downPayment;
    if (loanAmount < 0) loanAmount = 0;

    let annualMortgagePayment = inputLoanRepayment * 12;

    let purchasePricePerM2 = fallbackDefaultEconomics.purchasePricePerM2;
    if (!isNaN(inputPriceM2) && inputPriceM2 > 0) {
        purchasePricePerM2 = inputPriceM2;
    } else if (activeSelectedProperties) {
        const parsed = extractNumericValue(activeSelectedProperties.Kaufpreis);
        if (parsed) purchasePricePerM2 = parsed;
    }
    //Morate payment is calculated based on price per sqrm and property size minus downpayment times the mortage rate (3.5%)
    let baseMortgagePayment = (buySize * inputPriceM2 - downPayment) * (1 + mortgageRate);

    // Auto update the Loan Amount based on the property size and map parameters
    // If the user input is checked the value stop auto updating, without the checkbox it would constantly overwrite the user intput
    window.addEventListener("click", function () {
        const isCustomLoanEnabled = document.getElementById('toggle-loan-check').checked;
        if (!isCustomLoanEnabled) {
            document.getElementById("param-loan-amount").value = Math.round(baseMortgagePayment);
        }
        if (activeSelectedProperties) {
            document.getElementById("param-rent").value = Math.round(activeSelectedProperties.miete * rentSize);
        }
    });

    // Owner starts at a baseline deficit of their non-recoverable upfront costs
    // The Owner of a new Hous starts initially in the negative since he/she hasnt repaid their loan yet
    // But with every year the loan repayment is added to the Value of the purchased property
    // By that logic after the loan is re-payed the owner should have a higher net worth since he/she,
    // by then, owns the house and the home has increased in its worth every year (by the appreciation rate)
    // My logic is that if the user has paid off 0% of the bank-loan the bank owns 100% of the property value
    // If the user has paid off 50% of the mortgage he/she then owns 50% of the property value and can add that to his/her net-worth

    let breakEvenYear = null;
    let totalRentOutflow = closingCosts - rentDeposit;
    let totalPurchaseOutflow = downPayment + closingCosts;
    let currentRent = monthlyRent*12;
    let remainingLoan = inputLoanAmount*1.035;
    let homeValue = purchasePrice;
    let inflationAdjustedIncome = monthlyIncome*12;

    if(activeSelectedProperties === null){
        let avgMiete = 0;
        let avgKaufpreis = 0;
    } else {
        let avgMiete = extractNumericValue(activeSelectedProperties.miete) * 80;
        let avgKaufpreis = extractNumericValue(activeSelectedProperties.Kaufpreis) * 80;


    //Average Prices using Local Data from .json files
    const ownerNetWorthData = [Math.round(
        3000
        + avgKaufpreis
        - (avgKaufpreis - 25000)*1.035 //Durchscnittlicher Kredit
        )];
    const renterNetWorthData = [Math.round(
        3000
        - avgMiete
        - avgMiete*0.12 //Durschnittliche extra Wohnnebenkosten
    )];
    const labels = ['Year 0'];

    let ownerNetWorth = ownerNetWorthData[0];
    let renterNetWorth = renterNetWorthData[0];

    // Property net-worth contribution of the House is 0 because 0% of the loan is paid off. E.g. the Bank still owns the House until the user pays back the loan
    // net-wealth is in the negative because upfront closing costs and down payments are gone. (Means normally the renter should now be clear of the house/apartment buyer)
    let buyerHomeValue = purchasePrice;
    let buyerRemainingLoan = loanAmount;
    let buyerSavingsAccount = downPayment - totalUpfrontRequired - baseMortgagePayment;

    const cumulativePurchasePaidData = [Math.round(0 + buyerSavingsAccount)];

    let renterSavingsAccount = totalUpfrontRequired - rentDeposit;
    if (renterSavingsAccount < 0) renterSavingsAccount = 0;

    const cumulativeRentPaidData = [Math.round(renterSavingsAccount + rentDeposit)];

    let currentAnnualIncome = monthlyIncome * 12;
    let currentAnnualRent = monthlyRent * 12;
    let currentAnnualGeneralExpenses = avgMonthlyExpenses * 12; // Formulating annual basis
    let breakEvenYear = null;

    // 30-Year Projection Loop
    for (let year = 0; year <= 30; year++) {
        inflationAdjustedIncome *= 1.025

        ownerNetWorthData.push(Math.round(ownerNetWorth+=
            inflationAdjustedIncome
            + avgKaufpreis*0.04
            - inputLoanRepayment
        ));
        renterNetWorthData.push(Math.round(renterNetWorth+=
            inflationAdjustedIncome
            -(avgMiete*12*1.02)
        ));

        //Inflation Adjustments
        currentAnnualIncome *= (1 + incomeGrowthRate);
        currentAnnualGeneralExpenses *= (1 + 0.037); // Applying standard inflation rate to all none housing related extra costs.

        buyerHomeValue *= (1 + appreciationRate);

        let dynamicAnnualPayment = annualMortgagePayment;
        let principalRepayment = 0;

        if (buyerRemainingLoan > 0) {
            let interestPayment = buyerRemainingLoan * mortgageRate;

            principalRepayment = dynamicAnnualPayment - interestPayment;

            // Guard rails in case the user's input is lower than the structural interest requirement
            if (principalRepayment < 0) {
                principalRepayment = 0;
                buyerRemainingLoan += (interestPayment - dynamicAnnualPayment);
            } else if (principalRepayment > buyerRemainingLoan) {
                // If the payment is larger than the final remaining debt it is capped
                principalRepayment = buyerRemainingLoan;
                dynamicAnnualPayment = interestPayment + principalRepayment;
                buyerRemainingLoan = 0;
            } else {
                buyerRemainingLoan -= principalRepayment;
            }
        } else {
            dynamicAnnualPayment = 0;
        }

        let ratioPaid = 1.0;
        if (loanAmount > 0) {
            ratioPaid = (loanAmount - buyerRemainingLoan) / loanAmount;
            if (ratioPaid < 0) ratioPaid = 0;
        }

        let ownerHomeEquityValue = buyerHomeValue * ratioPaid;
        let annualMaintenance = buyerHomeValue * maintenanceRate;

        let buyerSurplus = currentAnnualIncome - dynamicAnnualPayment - annualMaintenance - currentAnnualGeneralExpenses;
        buyerSavingsAccount += buyerSurplus;

        let totalBuyerNetWorth = ownerHomeEquityValue + buyerSavingsAccount;
        cumulativePurchasePaidData.push(Math.round(totalBuyerNetWorth));


        currentAnnualRent *= (1 + rentIncreaseRate);

        let renterSurplus = currentAnnualIncome - currentAnnualRent - currentAnnualGeneralExpenses;
        renterSavingsAccount += renterSurplus;

        let totalRenterNetWorth = renterSavingsAccount + rentDeposit;
        cumulativeRentPaidData.push(Math.round(totalRenterNetWorth));

        //Timeline Comparison
        labels.push(`Year ${year}`);

        if (breakEvenYear === null && totalBuyerNetWorth > totalRenterNetWorth) {
            breakEvenYear = year;
        }
    }

    renderLineChartCanvas(labels, renterNetWorthData, ownerNetWorthData, cumulativeRentPaidData, cumulativePurchasePaidData);
    updateBreakEvenSummary(cumulativePurchasePaidData, cumulativeRentPaidData);
    }
}

function inputExceptionHandler(){

    const banner = document.getElementById('debt-warning-overlay');
    const warningTitle = document.getElementById('warning-title');
    const warningDescription = document.getElementById('warning-description');

    if (monthlyIncome-avgMonthlyExpenses < inputLoanRepayment) {
        // Condition 1: Monthly loan repayment exceeds total household income
        warningTitle.innerHTML = `⚠️ Repayment Exceeds Income`;
        warningDescription.innerHTML = `
        <p>Your entered monthly loan repayment of <strong>${inputLoanRepayment.toLocaleString('de-AT')} €</strong> is higher than your total net monthly income of <strong>${monthlyIncome.toLocaleString('de-AT')} €</strong>.</p>
        <p style="margin-top: 8px; color: #666;">You cannot commit to a mortgage payment that exceeds your total earnings. Please lower the repayment amount or increase the household income parameter.</p>
    `;
        banner.style.display = 'flex'; // Uses flex layout to center the popup box

    } else if (monthlyIncome < monthlyRent) {
        // Condition 2: Base rent cost exceeds total household income
        warningTitle.innerHTML = `⚠️ Rent Exceeds Income`;
        warningDescription.innerHTML = `
        <p>The baseline monthly rent of <strong>${monthlyRent.toLocaleString('de-AT')} €</strong> for this district is greater than your total monthly net household income of <strong>${monthlyIncome.toLocaleString('de-AT')} €</strong>.</p>
        <p style="margin-top: 8px; color: #666;">This renders the renting strategy unviable. Please adjust the desired rental property size down or increase income parameters.</p>
    `;
        banner.style.display = 'flex';

    } else if (inputLoanAmount > inputLoanRepayment * 12 * 30) {
        const totalPaid30Years = inputLoanRepayment * 12 * 30;
        const remainingDebt = inputLoanAmount - totalPaid30Years;

        warningTitle.innerHTML = `⚠️ Insufficient Loan Repayment`;
        warningDescription.innerHTML = `
        <p>Your current monthly loan repayment setting is too low to fully amortize the mortgage over the timeline. Over 30 years, you will have paid back <strong>${totalPaid30Years.toLocaleString('de-AT')} €</strong>.</p>
        <p style="margin-top: 8px;">After the 30-year simulation window closes, you would still owe the bank:</p>
        <div style="background-color: #fdf2f2; margin-top: 10px; padding: 12px; border-radius: 6px; text-align: center; border: 1px solid #f5c6cb;">
            <strong style="color: #ae0000; font-size: 1.4rem; font-weight: 700;">${Math.round(remainingDebt).toLocaleString('de-AT')} €</strong>
        </div>
    `;
        banner.style.display = 'flex';

    } else if (inputLoanAmount*1.035 + downPayment < inputPriceM2*buySize && inputLoanAmount !== 0) {
        // Condition 4: Capital allocation shortfall / Funding Gap
        const totalAvailableFunds = inputLoanAmount + downPayment;
        const shortfall = inputPriceM2*buySize - totalAvailableFunds;

        warningTitle.innerHTML = `⚠️ Funding Gap Detected`;
        warningDescription.innerHTML = `
        <p>The specified loan amount combined with your available equity capital does not cover the total purchase price of this property.</p>
        <div style="background-color: #fff9db; margin-top: 10px; padding: 12px; border-radius: 6px; border: 1px solid #ffe066; font-size: 0.88rem; color: #444; display: flex; flex-direction: column; gap: 4px;">
            <div>Total Purchase Price: <strong style="float: right; color: #333;">${Math.round(inputPriceM2*buySize).toLocaleString('de-AT')} €</strong></div>
            <div>Your Available Funds: <strong style="float: right; color: #333;">${Math.round(totalAvailableFunds).toLocaleString('de-AT')} €</strong></div>
            <div style="border-top: 1px dashed #ffe066; margin-top: 6px; padding-top: 6px; font-weight: bold; color: #e65100;">
                Shortfall / Gap: <strong style="float: right; font-size: 1.1rem;">${Math.round(shortfall).toLocaleString('de-AT')} €</strong>
            </div>
        </div>
    `;
        banner.style.display = 'flex';
    } else {
        // Everything is completely valid, secure the view
        banner.style.display = 'none';
    }
}

function hideDebtWarningPopup() {
    const banner = document.getElementById('debt-warning-overlay');
    if (banner) {
        banner.style.display = 'none';
    }
}


function renderLineChartCanvas(labels, rentData, buyData, cumRentData, cumBuyData) {
    const ctx = document.getElementById('breakEvenChart').getContext('2d');
    if (!ctx) return;

    if (breakEvenChartInstance) {
        breakEvenChartInstance.data.labels = labels;
        breakEvenChartInstance.data.datasets[0].data = rentData;
        breakEvenChartInstance.data.datasets[1].data = buyData;
        breakEvenChartInstance.data.datasets[2].data = cumRentData;
        breakEvenChartInstance.data.datasets[3].data = cumBuyData;
        toggleChartLineVisibility();
    } else {
        breakEvenChartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    { label: 'Renter Value', data: rentData, borderColor: '#2e7d32', backgroundColor: 'transparent', borderWidth: 1.5, borderDash: [4, 4], tension: 0.1, pointRadius: 0, fill: false },
                    { label: 'Owner Value', data: buyData, borderColor: '#0066cc', backgroundColor: 'transparent', borderWidth: 1.5, borderDash: [4, 4], tension: 0.1, pointRadius: 0, fill: false },
                    { label: 'User input Rent Value', data: cumRentData, borderColor: '#e6a23c', backgroundColor: 'transparent', borderWidth: 2, tension: 0.1, pointRadius: 1, fill: false },
                    { label: 'User input Purchase Value', data: cumBuyData, borderColor: '#ae0000', backgroundColor: 'transparent', borderWidth: 2, tension: 0.1, pointRadius: 1, fill: false },
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false, // Core attribute flag allowing the canvas element box to scale automatically
                plugins: {
                    legend: { display: false },
                    tooltip: { mode: 'index', intersect: false }
                },
                scales: {
                    x: { grid: { display: false }, ticks: { font: { size: 9 }, maxTicksLimit: 10 } },
                    y: {
                        ticks: {
                            callback: function(v) {
                                // Correctly prefixes negative numbers: e.g., -€50k instead of €-50k
                                if (v < 0) {
                                    return '-€' + (Math.abs(v) / 1000) + 'k';
                                }
                                return '€' + (v / 1000) + 'k';
                            },
                            font: { size: 9 }
                        }
                    }
                }
            }
        });
        toggleChartLineVisibility();
    }
}

function updateBreakEvenSummary(purchaseData, rentData) {
    const summaryBox = document.getElementById('break-even-summary-text');
    const readMoreBtn = document.getElementById('btn-read-more');
    const modalTextBox = document.getElementById('modal-detailed-text');

    if (!summaryBox) return;

    // 1. Calculate outcomes and differences for Year 30 (index 29)
    const finalRenterNetWorth = rentData[29];
    const finalOwnerNetWorth = purchaseData[29];
    const netWorthDifference = Math.abs(finalRenterNetWorth - finalOwnerNetWorth);
    const winner = finalRenterNetWorth > finalOwnerNetWorth ? "Renter" : "Property Owner";

    let breakEvenYear = null;
    for (let year = 0; year < 30; year++) {
        if (purchaseData[year] > rentData[year]) {
            breakEvenYear = year + 1;
            break;
        }
    }

    let summaryBriefText = "";
    if (breakEvenYear) {
        summaryBriefText = `
            <strong>Here is the quick takeaway:</strong> Buying this property beats renting in the long run, and you hit the financial turning point in 
            <span style="color: #ae0000; font-weight: bold;">Year ${breakEvenYear}</span>. By Year 30, the 
            <strong>${winner}</strong> strategy accumulates about <strong>${Math.round(netWorthDifference).toLocaleString('de-AT')} €</strong> more in total net worth!
        `;
    } else {
        summaryBriefText = `
            <strong>Here is the quick takeaway:</strong> Based on these settings, the <strong>${winner}</strong> stays ahead for the entire 30-year timeline. 
            By the end, renting beats buying by a margin of <strong>${Math.round(netWorthDifference).toLocaleString('de-AT')} €</strong> in total wealth.
        `;
    }

    summaryBox.innerHTML = summaryBriefText;

    const totalPurchaseCost = buySize * inputPriceM2;

    let extendedDeepDiveText = `
        <p>Here is a detailed explenation on what our Graph represents, what a break even point is and how it is calculated.</p>
        
        <h4 style="margin-top: 15px; margin-bottom: 5px; color: #ae0000; font-size: 1.5rem;">Disclaimer:</h4>
        <p>
        We use net worth over time as our main metric because it provides the most accurate representation of your overall wealth. It includes both your accumulated savings and the value of your property.
        If we only looked at the amount of cash left after 30 years, and assumed you made no purchases other than your average monthly living expenses (which is very unlikely), a renter would almost always have more cash available than a buyer, even at the break-even point. 
        This is because a buyer has invested a significant portion of their savings and income into purchasing a property.
        Therefore, the most accurate way to represent our data is by considering all relevant financial assets instead of only the remaining cash.
        </p>
        
        <h4 style="margin-top: 15px; margin-bottom: 5px; color: #ae0000; font-size: 1.5rem;">Graph Description:</h4>
        <p>
            <strong>Green dotted line:</strong> Represents the average net-worth development of a renter living in the selected state or district. The calculation is based on the average rent for an 80 m² property.
            <br><strong>Blue dotted line:</strong> Represents the average net-worth development of a homeowner who already owns an 80 m² property in the selected state or district. It is assumed that any mortgage has already been fully paid off.
            <br><strong>Yellow line:</strong> Represents your projected net-worth development while renting. It combines your personal financial information with the average rental prices and living costs in the selected state or district.
            <br><strong>Red line:</strong> Represents your projected net-worth development while buying. It combines your personal financial information with the average property prices and ownership costs in the selected state or district.
        </p>
        
        <h4 style="margin-top: 15px; margin-bottom: 5px; color: #ae0000; font-size: 1.5rem;">Break-Even Point</h4>
        <p>
        The break-even point is where the red and yellow lines intersect. It marks the point at which buying and renting result in the same net worth.
        After this point, owning a property generally becomes the better financial investment. In most scenarios, the break-even point indicates when buying starts to outperform renting in terms of total net worth.
        </p>
        
        <h4 style="margin-top: 15px; margin-bottom: 5px; color: #ae0000; font-size: 1.5rem;">How Does the Break-Even Calculator Work?</h4>
        <p>
        <h4>Renting</h4>
        You start with your available equity, minus any rental deposit, which remains in your bank account. Every month, the calculator adds your income and subtracts your living expenses and rent. Rent is assumed to increase by approximately 2.3% per year, based on the average rent increase in Austria.
        <br>If renting remains significantly cheaper than paying a mortgage, you are able to save more money each month. Over time, these savings increase your overall net worth and may outperform buying, depending on your situation.
        <h4>Buying</h4>
        When purchasing a property, you first pay the typical Austrian closing costs, including expenses such as Grunderwerbsteuer, Grundbucheintragung, Maklergebühren, and Notarkosten. These costs are based on Austrian averages and are added to the mortgage amount.
        <br>Because of these upfront expenses, buyers often start with a negative net worth. Each month, you make a fixed mortgage payment. The calculator tracks both the increase in your property's market value and the reduction of your remaining loan balance. With every mortgage payment, you gradually transfer ownership of the property from the bank to yourself.
        </p>
        
        <h3 style="margin-top: 15px; margin-bottom: 5px; color: #ae0000; font-size: 1.5rem;">Purchasing a propety based on your information:</h3>
        <p>
            The selected district has a property price of <strong>${Math.round(inputPriceM2).toLocaleString('de-AT')} € per m²</strong>. 
            Multiplying that by your desired size of ${buySize}m² brings the raw sticker price of the home to <strong>${Math.round(totalPurchaseCost).toLocaleString('de-AT')} €</strong>.
        </p>
        <p style="margin-top: 6px;">
            Since you are putting down your <strong>${downPayment.toLocaleString('de-AT')} €</strong> of hard equity capital right away, you have to take a loan for the rest. 
            That leaves you with a bank loan principal of <strong>${Math.round(inputLoanAmount).toLocaleString('de-AT')} €</strong>. 
            Every single month, you lock in a fixed <strong>${inputLoanRepayment.toLocaleString('de-AT')} €</strong> mortgage repayment. 
            Out of your monthly houshold income of <strong>${monthlyIncome.toLocaleString('de-AT')} €</strong>, after paying the bank and your normal living expenses of <strong>${avgMonthlyExpenses.toLocaleString('de-AT')} €</strong>, 
            whatever income is left over gets saved. Furthermore, everytime you pay back a portion of the loan, the repayment value is added to the value of your purchased property.
            As an example, if you pay of 50% of your loan, about 50% of your property value (+ appreciation) is added to your net-worth.
        </p>

        <h3 style="margin-top: 15px; margin-bottom: 5px; color: #ae0000; font-size: 1.5rem;">Renting a propety based on your information:</h3>
        <p>
            Instead of buying, you start by renting an <strong>${rentSize.toLocaleString('de-AT')} m²</strong> space. Your initial monthly rent is set at <strong>${monthlyRent.toLocaleString('de-AT')} €</strong>, 
            and you hand over an upfront safety deposit of <strong>${rentDeposit.toLocaleString('de-AT')} €</strong>.
        </p>
        <p style="margin-top: 6px;">
            Crucially, the renter gets to keep their <strong>${downPayment.toLocaleString('de-AT')} €</strong> of equity in their pocket on Day 1 and also dosnt need to pay the additional upfront costs that come with buying a property.
            With the additional cash, you would keep a sizable lead, at the start, in the net-worth race, depending on the desired property location and size the buyer sometimes cant catch up.           
        </p>

        <h4 style="margin-top: 15px; margin-bottom: 5px; color: #ae0000; font-size: 1.5rem;">Why do the lines cross? (The Break Even Point)</h4>
        <p>
            Why does the chart change?:
        </p>
        <ul style="margin-left: 20px; margin-top: 6px; margin-bottom: 10px; line-height: 1.5; color: #4a5568;">
            <li><strong>Rent Inflation:</strong> Your rent isn't fixed. With an expected annual increase of <strong>${2.0}%</strong>, that initial ${monthlyRent} € payment quietly creeps up year after year, slowly eating away at the renter's monthly savings pool.</li>
            <li><strong>The 30-Year Loan Horizon:</strong> While the renter's payments keep climbing forever, the buyer's mortgage eventually gets fully paid off. Suddenly, the buyer owns a massive, valuable asset completely debt-free and has zero housing payments!</li>
        </ul>
        
        <p style="margin-top: 12px; background: #fdf2f2; padding: 12px; border-radius: 4px; font-weight: 500; border-left: 3px solid #ae0000;">
            <strong>Final Verdict:</strong> ${breakEvenYear
        ? `In the beginning, the renter is wealthier due to the saved "cash" and lower additional initial costs. But around <strong>Year ${breakEvenYear}</strong>, the rising cost of rent and the building value of the property owner causes the lines to cross. After 30 years, the property owner wins by a sizeable margin of <strong>${Math.round(netWorthDifference).toLocaleString('de-AT')} €</strong>.`
        : `Due to the disparity in the property purchasing price and the monthly rent, the renter's net-worth grows faster, then that of the property owner. Over the 30-year horizon, renting remains the financially superior path by <strong>${Math.round(netWorthDifference).toLocaleString('de-AT')} €</strong>.`}
        <br> This ofcourse only takes into consideration the average monthly operating costs and does not 100% accuratly represent a house or appartments real monthly costs.
        </p>
    `;

    if (modalTextBox) {
        modalTextBox.innerHTML = extendedDeepDiveText;
        if (readMoreBtn) readMoreBtn.style.display = "inline-block";
    } else if (readMoreBtn) {
        readMoreBtn.style.display = "none";
    }
}

window.addEventListener('DOMContentLoaded', () => {
    const mapEl = document.getElementById('map');
    if (mapEl) {
        // Ensure the container actually exists in the DOM
        map = L.map('map', {
            zoomControl: true,
            minZoom: 4,
            maxZoom: 11,
            maxBounds: L.latLngBounds(L.latLng(46.2, 9.3), L.latLng(49.1, 17.3)),
            maxBoundsViscosity: 1.0
        }).setView([47.61, 13.78], 7);

        // Trigger file fetches ONLY after Leaflet sets up the DOM node anchor
        loadGeoJsonFiles();
        updateLegendLabels('Kaufpreis');
    }
});

// Forces Leaflet to recalibrate and adjust internal tile alignment limits immediately on viewport adjustment events
window.addEventListener('resize', () => {
    if (map) {
        map.invalidateSize({ animate: true });
    }
});

//Logic functions to open and close the modal view
function openDetailModal() {
    const overlay = document.getElementById('detail-modal-overlay');
    overlay.classList.add('active');
}

function closeDetailModal() {
    const overlay = document.getElementById('detail-modal-overlay');
    overlay.classList.remove('active');
}

//Integration hook to place inside your current calculateBreakEven() logic
function updateSummaryDisplay(summaryBriefText, extendedDeepDiveText) {
    const summaryBox = document.getElementById('break-even-summary-text');
    const readMoreBtn = document.getElementById('btn-read-more');
    const modalTextBox = document.getElementById('modal-detailed-text');

    // Set text to short dashboard window summary box
    summaryBox.innerHTML = summaryBriefText;

    if (extendedDeepDiveText && extendedDeepDiveText.trim() !== "") {
        // Place comprehensive text analysis inside modal container
        modalTextBox.innerHTML = extendedDeepDiveText;
        // Make the link visible below the brief description box
        readMoreBtn.style.display = "inline-block";
    } else {
        readMoreBtn.style.display = "none";
    }
}