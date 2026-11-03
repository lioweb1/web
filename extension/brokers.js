/**
 * Broker selector profiles.
 *
 * These mirror bot/binarybot/brokers/profiles/*.yaml. They are best guesses:
 * broker front-ends change often, so VERIFY them on a demo account with the
 * popup's "Test selectors" button and put corrections in the popup's
 * "Selector overrides" box (or edit this file).
 *
 * Each selector may be a comma separated list; the first element that matches
 * wins. `assetLabel` is used only for the symbol sanity check.
 */
(function (root) {
  "use strict";

  root.__bbBrokers = [
    {
      id: "pocketoption",
      name: "Pocket Option",
      match: /(^|\.)(pocketoption\.com|po\.trade)$/i,
      amountFormat: "{:.0f}",
      balance: ".balance-info-block__balance, .js-balance-demo, .js-balance-real",
      amountInput: ".block--bet-amount input, .value__val input",
      callButton: ".btn-call, .switch-state-block__item--call, a.btn.btn-call",
      putButton: ".btn-put, .switch-state-block__item--put, a.btn.btn-put",
      assetLabel: ".current-symbol, .currencies-block .pair-name, .pair-number-wrap .pair-name",
    },
    {
      id: "quotex",
      name: "Quotex",
      match: /(^|\.)(qxbroker\.com|quotex\.io|quotex\.com)$/i,
      amountFormat: "{:.0f}",
      balance: ".usermenu__info-balance, .header__balance",
      amountInput: ".section-deal__investment input, .input-control__input[name='investment']",
      callButton: ".call-btn, button.section-deal__button--call",
      putButton: ".put-btn, button.section-deal__button--put",
      assetLabel: ".asset-select__name, .section-deal__name, .chart-tab__name",
    },
    {
      id: "iqoption",
      name: "IQ Option",
      match: /(^|\.)iqoption\.com$/i,
      amountFormat: "{:.0f}",
      balance: ".balance-info .balance, [data-test-id='balance']",
      amountInput: ".amount-input input, [data-test-id='amount-input']",
      callButton: "[data-test-id='call-button'], .call-btn",
      putButton: "[data-test-id='put-button'], .put-btn",
      assetLabel: "[data-test-id='active-asset'], .active-asset-name, .asset-name",
    },
    {
      id: "olymptrade",
      name: "Olymp Trade",
      match: /(^|\.)olymptrade\.com$/i,
      amountFormat: "{:.0f}",
      balance: ".balance__value, [data-test='balance']",
      amountInput: ".deal-amount input, [data-test='amount-input']",
      callButton: "[data-test='deal-button-up'], .button-up",
      putButton: "[data-test='deal-button-down'], .button-down",
      assetLabel: "[data-test='asset-name'], .asset-name, .pair-name",
    },
  ];

  /** Find the profile for a hostname and apply user overrides (if any). */
  root.__bbResolveBroker = function (hostname, overrides) {
    const base = root.__bbBrokers.find((b) => b.match.test(hostname));
    if (!base) return null;
    const o = (overrides && overrides[base.id]) || {};
    return Object.assign({}, base, o);
  };
})(globalThis);
