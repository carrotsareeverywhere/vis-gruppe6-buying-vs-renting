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
    let min, max;

    //Values are not the exact minimum and maximum but rather a try and error approach for a more logical colouring.
    if (metric === 'Kaufpreis') {
        min = 1850;
        max = 4500;
    } else { // miete
        min = 7.5;
        max = 11;
    }

    // If data is missing or 0, return a neutral gray
    if (!value || value === 0) return '#b0b0b0';

    // Calculate where the value sits between 0 and 1
    let ratio = (value - min) / (max - min);
    if (ratio < 0) ratio = 0;
    if (ratio > 1) ratio = 1;

    // Segregate the heatmap into 11 distinct color steps
    const steps = 11;
    const bucket = Math.floor(ratio * (steps - 1));

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
                        <p style="margin-top: 4px;"><strong>Avg. Miete:</strong> ${props.miete || 'Data Pending'} (per m²) (€)</p>
                    </div>
                `;
            } else {
                const stateCode = props.iso ? props.iso.substring(0, 1) : '';
                const stateName = stateIsoMap[stateCode] || 'Austria Region';

                contentDiv.innerHTML = `
                    <div class="data-card">
                        <h3>${props.name || 'Unknown District'}</h3>
                        <p style="color: #666; font-size: 0.9rem;">Bundesland: ${stateName}</p>
                        <p style="margin-top: 8px;"><strong>Kaufpreis:</strong> ${props.Kaufpreis || 'Data Pending'}</p>
                        <p style="margin-top: 4px;"><strong>Miete:</strong> ${props.miete || 'Data Pending'}</p>
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
    let min, max;
    let currencySymbol = "€";

    if (metric === 'Kaufpreis') {
        min = 1850;
        max = 4500;
    } else { // miete
        min = 7.5;
        max = 11;
    }

    const steps = 11;
    const stepSize = (max - min) / (steps - 1); // Calculates the span of each middle bucket

    for (let i = 0; i < steps; i++) {
        const labelElement = document.getElementById(`legend-label-${i + 1}`);

        if (labelElement) {
            let labelText = "";

            if (i === 0) {
                labelText = `> ${currencySymbol}${Math.round(max)}`;
            } else if (i === steps - 1) {
                labelText = `< ${currencySymbol}${Math.round(min)}`;
            } else {
                let currentLowerBound = min + (i - 0.5) * stepSize;
                let currentUpperBound = min + (i + 0.5) * stepSize;

                if (metric === 'miete') {
                    labelText = `${currencySymbol}${currentLowerBound.toFixed(1)} - ${currencySymbol}${currentUpperBound.toFixed(1)}`;
                } else {
                    labelText = `${currencySymbol}${Math.round(currentLowerBound)} - ${currencySymbol}${Math.round(currentUpperBound)}`;
                }
            }

            labelElement.textContent = labelText;
        }
    }
}

function calculateBreakEven() {
    const canvasEl = document.getElementById('breakEvenChart');
    if (!canvasEl) return;

    // Extract sizing inputs explicitly
    const buySize = parseFloat(document.getElementById("param-buy-size").value) || 80;
    const rentSize = parseFloat(document.getElementById("param-rent-size").value) || 80;
    const monthlyIncome = parseFloat(document.getElementById("param-income").value) || 4500;
    const downPayment = parseFloat(document.getElementById("param-capital").value) || 0;
    const inputPriceM2 = parseFloat(document.getElementById("param-price-m2").value) || 0;
    const inputLoanAmount = parseFloat(document.getElementById("param-loan-amount").value) || 0;
    const inputLoanRepayment = parseFloat(document.getElementById("param-loan-repayment").value) || 0;
    const monthlyRent = parseFloat(document.getElementById("param-rent").value) || 0;
    const rentDeposit = parseFloat(document.getElementById("param-deposit").value) || 0;
    const userRentIncreaseRate = parseFloat(document.getElementById("param-rent-increase").value) || 2.0;

    const avgMonthlyExpenses = parseFloat(document.getElementById("param-monthly-expenses").value) || 400;

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
        let avgMiete = extractNumericValue(activeSelectedProperties.miete) * 100;
        let avgKaufpreis = extractNumericValue(activeSelectedProperties.Kaufpreis) * 100;


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
    let buyerSavingsAccount = -totalUpfrontRequired;

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

        // BUYER CALCULATIONS
        buyerHomeValue *= (1 + appreciationRate);

        let dynamicAnnualPayment = annualMortgagePayment;
        let principalRepayment = 0;

        // If there is still a loan balance to pay off
        if (buyerRemainingLoan > 0) {
            let interestPayment = buyerRemainingLoan * mortgageRate;

            principalRepayment = dynamicAnnualPayment - interestPayment;

            // Guard rails in case the user's input is lower than the structural interest requirement
            if (principalRepayment < 0) {
                principalRepayment = 0;
                // The loan is growing because the user isn't covering the interest (Negative Amortization)
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
            // Loan is completely paid off, user pays 0 mortgage from this year onward
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
    updateBreakEvenSummary(breakEvenYear);
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
                    { label: 'Renter Portfolio Value', data: rentData, borderColor: '#2e7d32', backgroundColor: 'transparent', borderWidth: 1.5, borderDash: [4, 4], tension: 0.1, pointRadius: 0, fill: false },
                    { label: 'Owner Equity Value', data: buyData, borderColor: '#0066cc', backgroundColor: 'transparent', borderWidth: 1.5, borderDash: [4, 4], tension: 0.1, pointRadius: 0, fill: false },
                    { label: 'User input Rent', data: cumRentData, borderColor: '#e6a23c', backgroundColor: 'transparent', borderWidth: 2, tension: 0.1, pointRadius: 1, fill: false },
                    { label: 'User input Purchase', data: cumBuyData, borderColor: '#ae0000', backgroundColor: 'transparent', borderWidth: 2, tension: 0.1, pointRadius: 1, fill: false },
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

function updateBreakEvenSummary(breakEvenYear) {
    const textContainer = document.getElementById('break-even-summary-text');
    const readMoreBtn = document.getElementById('btn-read-more');
    const modalTextBox = document.getElementById('modal-detailed-text');

    if (!textContainer) return;
    const regionHeadline = activeSelectedProperties ? activeSelectedProperties.name : "Active Dashboard Profile";

    //TODO: Replace AI generated placeholder Text with a more detailed and logical text that uses more of the user inputs to explain the graph

    // Variables to store the split text tracks
    let shortText = "";
    let detailedText = "";

    if (breakEvenYear) {
        // 1. Keep your original short dashboard text
        shortText = `<strong>${regionHeadline}:</strong> Purchase asset outperformance optimizes at <strong>Year ${breakEvenYear}</strong>. Beyond this horizon, property equity growth moves faster than renter capital portfolio compounding.`;

        // 2. Build the detailed pop-up extension
        detailedText = `
            <p><strong>Long-Term Strategy Analysis for ${regionHeadline}:</strong></p>
            <p style="margin-top: 10px;">In the initial years, the renter holds a financial edge because renting avoids heavy upfront transaction friction, loan processing overhead, and interest weight. This allows the renter's excess capital to compound uninterrupted in portfolio assets.</p>
            <p style="margin-top: 10px;">However, by <strong>Year ${breakEvenYear}</strong>, a structural shift occurs. The landlord's rent inflation vector (compounding over time) increases the renter's monthly liabilities. Meanwhile, the buyer's fixed-rate amortization schedule steadily drops the outstanding principal balance, accelerating equity ownership gains.</p>
            <p style="margin-top: 10px;">Passing this cross-over timeline makes property purchasing the structurally superior wealth vehicle for this region under current market parameters.</p>
        `;

        // Stylize the dashboard summary container box (Green theme)
        textContainer.style.borderLeftColor = "#67c23a";
        textContainer.style.background = "#f0f9eb";
    } else {
        // 1. Keep your original short dashboard text
        shortText = `<strong>${regionHeadline}:</strong> Renter compounding portfolio allocation remains dominant over the 30-year study timeline.`;

        // 2. Build the detailed pop-up extension
        detailedText = `
            <p><strong>Long-Term Strategy Analysis for ${regionHeadline}:</strong></p>
            <p style="margin-top: 10px;">Across this specific asset layer timeline, purchasing a home does not achieve a financial break-even path within our 30-year projection matrix.</p>
            <p style="margin-top: 10px;">High regional purchase costs per square meter relative to local rental alternatives create a massive liquidity gap. The capital saved monthly by renting—when systematically allocated back into growth portfolios—outpaces real estate equity accumulation hands down.</p>
            <p style="margin-top: 10px;">Unless regional market conditions cycle lower, or rental rates jump dramatically, rental structures maximize wealth accumulation efficiency here over a 30-year span.</p>
        `;

        // Stylize the dashboard summary container box (Yellow theme)
        textContainer.style.borderLeftColor = "#e6a23c";
        textContainer.style.background = "#fdf6ec";
    }

    // Write short text version to dashboard panel
    textContainer.innerHTML = shortText;

    // Send extended text copy down to the hidden modal container
    if (modalTextBox) {
        modalTextBox.innerHTML = detailedText;
    }

    // Unhide the "Read More" button beneath the short message
    if (readMoreBtn) {
        readMoreBtn.style.display = "inline-block";
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