#!/usr/bin/env zx

/*
  Elafgift: 0,723
  Balancetarif: 0,00229
  Systemtarif: 0,061
  Transmissions nettarif: 0,049
  Netselskab - Radius C:
    lavlast: 0,3003
    spidslast: 0,7651

  lavlast: alle dage i perioden april-september + alle dage i perioden oktober-marts i tidsrummet 20.00-17.00.
  spidslast: alle dage i perioden oktober-marts i tidsrummet 17.00-20.00

  Source: https://radiuselnet.dk/elnetkunder/tariffer-og-netabonnement/
  Sanity Check: https://elspotpris.dk/
*/

import config from "./config.json" assert { type: "json" };

const dateFormatoptions = {
  weekday: "long",
  month: "long",
  day: "numeric",
};

const tax = 0.723;
const balanceTariff = 0.00229;
const systemTariff = 0.061;
const transmissionTariff = 0.049;
const UtilityTariff = {
  low: 0.3003,
  high: 0.7651,
};

const hourRange = 3;

const capitalize = (s) => s && s[0].toUpperCase() + s.slice(1);
const listStrings = (list) => {
  if (list.length <= 1) {
    return arr[0] + ".";
  }

  return `${list.slice(0, -1).join(", ")} og ${list.at(-1)}`;
};

const calcTotalPrice = (priceObj, vat = true) => {
  const date = new Date(priceObj.HourDK);

  let total =
    priceObj.SpotPriceDKK / 1000 +
    tax +
    balanceTariff +
    systemTariff +
    transmissionTariff +
    getUtilityTariff(date);

  if (vat) {
    total = total + (total * 25) / 100;
  }

  return Math.round(total * 100) / 100;
};

const getRawPrices = async () => {
  const prices = [];

  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);

  const start = today.toISOString().split("T")[0];
  const end = tomorrow.toISOString().split("T")[0];

  const url = new URL(config.apiUrl);
  const params = {
    start: `${start}T14:00`,
    end: `${end}T14:00`,
    filter: '{"PriceArea":["DK2"]}',
    sort: "HourUTC ASC",
    timezone: "dk",
  };
  url.search = new URLSearchParams(params).toString();

  return fetch(url)
    .then((response) => response.json())
    .then((data) => {
      data.records.forEach((priceObj) => {
        prices.push({
          ...priceObj,
          TotalPriceDKK: calcTotalPrice(priceObj),
        });
      });

      return prices;
    })
    .catch((error) => console.error(error));
};

const getUtilityTariff = (date) => {
  const month = date.getMonth();
  const hour = date.getHours();

  // Month is between the period October - March and Hour is in the period 17.00 - 20.00
  if ((month > 8 || month < 3) && hour > 16 && hour < 20) {
    return UtilityTariff["high"];
  } else {
    return UtilityTariff["low"];
  }
};

const findCheapestHours = () => {
  const ranges = [];
  let theSum = null;

  let lowest = {
    start: null,
    hours: [],
    avgPrice: null,
  };

  chunkArray();
  function chunkArray(i = 0) {
    let index = i;

    if (prices.length > hourRange) {
      ranges.push(prices.slice(0, hourRange));
      prices.shift();
      index++;

      chunkArray(index);
    } else {
      ranges.push(prices);
    }
  }

  ranges.forEach((range, index) => {
    let acc = {
      sum: null,
      index: null,
    };

    range.forEach((r) => (acc.sum = acc.sum + r.TotalPriceDKK));

    if (!theSum || acc.sum < theSum) {
      theSum = acc.sum;
      acc.index = index;
      lowest.hours = [];

      const start = ranges[acc.index][0].HourDK.split("T");

      ranges[acc.index].forEach((hour) => {
        lowest.hours.push(`${hour.HourDK.split("T")[1].split(":")[0]}:00`);
      });

      lowest.start = start[1];
      lowest.avgPrice = acc.sum / hourRange;
    }
  });

  return lowest;
};

const sendNotification = (success) => {
  const today = new Date();
  const payload = {
    topic: "Spotpris",
    title: capitalize(today.toLocaleString("da-DK", dateFormatoptions)),
  };

  if (success) {
    const { hours, avgPrice } = findCheapestHours();

    payload.tags = ["zap"];
    payload.message = `De næste 24 timer er den billigste periode på ${hourRange} timer: ${listStrings(
      hours
    )}.\nGennemsnitsprisen er ${avgPrice.toLocaleString("da-DK", {
      maximumFractionDigits: 2,
    })} kr/kWh`;
  } else {
    payload.tags = ["rotating_light"];
    payload.message = "Something went wrong with todays prices";
  }

  fetch(config.ntfyUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${config.ntfyAuth}`,
    },
    body: JSON.stringify(payload),
  })
    .then((resp) => resp.json())
    .then((data) => {
      if (!data.ok) {
        console.error(data);
      }
    })
    .catch((error) => console.error(error));
};

const prices = await getRawPrices();
sendNotification(prices.length > 0);
