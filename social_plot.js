(function () {
    'use strict';

    let initialized = false;

    window.initSocialPlots = function () {
        if (initialized) return;
        initialized = true;

        Promise.all([
            fetch('data/haushalte.json').then(r => r.json()),
            fetch('data/verfuegbares_einkommen_haushalte.json').then(r => r.json()),
        ]).then(([haushalte, einkommen]) => {
            renderSunburst('#sunburst-age-group', buildSunburstData(haushalte));
            renderIncomeChart('#income-cdf-chart', buildIncomeGroups(einkommen));
        });
    };

})();