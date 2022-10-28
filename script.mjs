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
  return `<b>${list.slice(0, -1).join(", ")}</b> og <b>${list.at(-1)}</b>`;
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

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dayAfterTomorrow = new Date();
  dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 2);

  const url = new URL(config.apiUrl);
  const params = {
    start: tomorrow.toISOString().split("T")[0],
    end: dayAfterTomorrow.toISOString().split("T")[0],
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
    date: null,
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

      lowest.date = start[0];
      lowest.start = start[1];
      lowest.avgPrice = acc.sum / hourRange;
    }
  });

  return lowest;
};

const sendNotification = () => {
  const { date, hours, avgPrice } = findCheapestHours();
  const theDate = new Date(date);

  fetch(`https://api.telegram.org/bot${config.telegramApiKey}/sendMessage`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      chat_id: config.telegramChatID,
      parse_mode: "HTML",
      text: `<b>${capitalize(
        theDate.toLocaleString("da-DK", dateFormatoptions)
      )}</b> er den billigste periode på <b>${hourRange}</b> timer: ${listStrings(
        hours
      )}.\nGennemsnitsprisen for perioden er <b>${avgPrice.toLocaleString(
        "da-DK"
      )}</b> kr/kWh.`,
    }),
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
sendNotification();
