// Hindi for the distributor screens. Text is looked up by its English wording, so anything
// not listed here simply stays in English. Staff screens are always English.
import { createContext, useContext } from "react";

const HI = {
  // menu and top bar
  "Home": "होम", "What's new": "नया क्या है", "Orders": "ऑर्डर", "Send order": "ऑर्डर भेजें", "Payments": "भुगतान",
  "Damage claims": "खराब माल", "Catalogue": "कैटलॉग", "Sign out": "लॉग आउट", "Distributor": "डिस्ट्रीब्यूटर",
  "Copied from Tally": "Tally से लिया गया", "updates every 10 minutes": "हर 10 मिनट में अपडेट", "never": "कभी नहीं",
  // home
  "Namaste, {name}": "नमस्ते, {name}", "As of {time}": "{time} तक की जानकारी",
  "📷 Photograph your order pad": "📷 ऑर्डर पैड की फ़ोटो भेजें", "Open orders": "खुले ऑर्डर",
  "not yet fully sent": "अभी पूरे नहीं भेजे", "Still to come": "आना बाकी", "{n} item sizes": "{n} आइटम साइज़",
  "Past their due date": "तारीख निकल चुकी", "item sizes": "आइटम साइज़", "New catalogues": "नए कैटलॉग",
  "Open the catalogue": "कैटलॉग खोलें", "Coming to you next": "आपको जल्द मिलेगा", "Nothing waiting": "कुछ बाकी नहीं",
  "Everything you ordered has been sent.": "आपका सारा ऑर्डर भेजा जा चुका है।", "from order": "ऑर्डर",
  "of": "दिनांक", "was due": "तारीख थी", "due": "तारीख", "no due date": "कोई तारीख नहीं",
  "See all open orders →": "सभी खुले ऑर्डर देखें →", "Recent orders": "हाल के ऑर्डर", "No orders yet": "अभी कोई ऑर्डर नहीं",
  "Your order requests": "आपके भेजे ऑर्डर", "Send one": "भेजें", "None sent yet": "अभी कुछ नहीं भेजा",
  "Write your order on your usual pad and send a photo.": "अपने पैड पर ऑर्डर लिखें और फ़ोटो भेजें।",
  "Order again of {n}": "{n} दोबारा", "Tell us you've paid": "भुगतान की जानकारी दें",
  "UPI, bank transfer or cheque": "UPI, बैंक ट्रांसफ़र या चेक", "Report damaged or short goods": "खराब या कम माल की शिकायत",
  "with photos": "फ़ोटो के साथ", "Your balance and bills will appear here soon.": "आपका बैलेंस और बिल जल्द यहाँ दिखेंगे।",
  "All news and offers →": "सारी खबरें और ऑफ़र →",
  "Your login isn't linked to your SNJ account yet. Please call SNJ.": "आपका लॉगिन अभी आपके खाते से नहीं जुड़ा है। कृपया SNJ को फ़ोन करें।",
  // labels the server sends
  "Pending": "बाकी", "Partly done": "कुछ भेजा", "Completed": "पूरा", "Cancelled": "रद्द",
  "With SNJ, being entered": "SNJ के पास, एंट्री हो रही है", "Entered, going into Tally": "एंट्री हो गई",
  "In Tally": "Tally में दर्ज", "Not entered": "एंट्री नहीं हुई", "SNJ is checking": "SNJ जाँच रहा है",
  "Received by SNJ": "SNJ को मिल गया", "Not found": "नहीं मिला", "Accepted": "मंज़ूर", "Not accepted": "मंज़ूर नहीं",
  "Scheme / offer": "स्कीम / ऑफ़र", "News": "खबर", "Valid till {d}": "{d} तक",
  // contact
  "Talk to SNJ": "SNJ से बात करें", "📞 Call": "📞 कॉल", "✉ Email": "✉ ईमेल",
  // orders
  "Your orders": "आपके ऑर्डर", "Every order, and what has been sent against it, size by size": "हर ऑर्डर और उसमें से कितना भेजा गया, साइज़ के हिसाब से",
  "Search order no. or item": "ऑर्डर नंबर या आइटम खोजें", "Still coming": "आना बाकी", "Fully sent": "पूरा भेजा", "All": "सभी",
  "Date": "तारीख", "Order no.": "ऑर्डर नं.", "Items": "आइटम", "Amount ₹": "रकम ₹", "Next due": "अगली तारीख", "Status": "स्थिति",
  "No orders here": "यहाँ कोई ऑर्डर नहीं", "Nothing is waiting to be sent.": "भेजने के लिए कुछ बाकी नहीं।",
  "Try another search.": "कुछ और खोजें।", "{n} items": "{n} आइटम", "{n} item": "{n} आइटम", "↻ Order again": "↻ दोबारा ऑर्डर",
  // send order
  "Send an order": "ऑर्डर भेजें", "Write your order on your usual pad and send a photo. SNJ enters it the same day.": "अपने पैड पर ऑर्डर लिखें और फ़ोटो भेजें। SNJ उसी दिन एंट्री करेगा।",
  "Sent. You can follow it below.": "भेज दिया। नीचे देख सकते हैं।", "Photograph your order pad": "ऑर्डर पैड की फ़ोटो लें",
  "or choose a photo you already took": "या पहले से ली हुई फ़ोटो चुनें", "Take another": "दूसरी फ़ोटो लें",
  "For which account": "किस खाते के लिए", "Anything to add?": "कुछ और बताना है?",
  "Optional, e.g. urgent, or send by a certain transport": "ज़रूरी नहीं, जैसे: अर्जेंट, या किसी खास ट्रांसपोर्ट से भेजें",
  "Send to SNJ": "SNJ को भेजें", "None yet": "अभी कुछ नहीं", "Order {n}": "ऑर्डर {n}",
  // order again
  "Order again": "दोबारा ऑर्डर", "Same items as {n} of {d}. Change any quantity, or make it 0 to leave it out.": "{n} ({d}) वाले आइटम। मात्रा बदलें, या हटाने के लिए 0 करें।",
  "Item": "आइटम", "Size": "साइज़", "Last time": "पिछली बार", "This time": "इस बार",
  "Optional, e.g. urgent, or a different transport": "ज़रूरी नहीं, जैसे: अर्जेंट, या दूसरा ट्रांसपोर्ट",
  "SNJ checks it and enters it, like an order photo.": "SNJ जाँच कर एंट्री करेगा।",
  "Send {n} item sizes to SNJ": "{n} आइटम साइज़ SNJ को भेजें", "Send {n} item size to SNJ": "{n} आइटम साइज़ SNJ को भेजें",
  "← Order {n}": "← ऑर्डर {n}",
  // payments
  "Paid by UPI, bank transfer or cheque? Tell SNJ here so your account is updated sooner.": "UPI, बैंक या चेक से भुगतान किया? यहाँ बताएँ ताकि आपका खाता जल्दी अपडेट हो।",
  "Thank you. SNJ will check it with the bank and confirm below.": "धन्यवाद। SNJ बैंक से जाँच कर नीचे पुष्टि करेगा।",
  "Paid on": "भुगतान की तारीख", "How": "कैसे", "UTR / transaction no.": "UTR / ट्रांज़ैक्शन नं.", "UTR no.": "UTR नं.",
  "Cheque no.": "चेक नं.", "Reference": "रेफ़रेंस", "Cash": "नकद", "Cheque": "चेक", "Other": "अन्य",
  "Screenshot or cheque photo": "स्क्रीनशॉट या चेक की फ़ोटो",
  "Optional, but it helps SNJ find your payment faster": "ज़रूरी नहीं, पर इससे SNJ जल्दी ढूँढ पाएगा",
  "Add a screenshot": "स्क्रीनशॉट जोड़ें", "Optional, e.g. which bills it is for": "ज़रूरी नहीं, जैसे: किन बिलों का भुगतान",
  "Tell SNJ": "SNJ को बताएँ", "Payments you told us about": "आपके बताए भुगतान", "Paid {d}": "भुगतान {d}", "told {t}": "बताया {t}",
  // claims
  "Report a problem with goods": "माल में समस्या बताएँ",
  "Damaged, short or wrong goods? Send photos and SNJ will sort it out.": "माल खराब, कम या गलत आया? फ़ोटो भेजें, SNJ हल करेगा।",
  "Sent. SNJ will look at it and reply below.": "भेज दिया। SNJ देखकर नीचे जवाब देगा।", "What went wrong": "क्या समस्या है",
  "Damaged": "खराब", "Short": "कम", "Wrong item": "गलत आइटम", "Which order": "कौन सा ऑर्डर", "Optional": "ज़रूरी नहीं",
  "Not sure": "पता नहीं", "How many": "कितना", "Pieces or dozens": "पीस या दर्जन", "Photos": "फ़ोटो",
  "Up to 3: the goods, the box and the label help most": "3 तक: माल, डिब्बा और लेबल की फ़ोटो सबसे अच्छी",
  "Add a photo": "फ़ोटो जोड़ें", "Tell us more": "और बताएँ", "Your reports": "आपकी शिकायतें", "order": "ऑर्डर",
  // account
  "Account": "खाता", "Your account": "आपका खाता", "From Tally, as of {time}": "Tally से, {time} तक",
  "Summary": "सारांश", "Bills": "बिल", "Statement": "स्टेटमेंट", "Payments received": "मिले भुगतान", "Your year": "आपका साल",
  "Nothing from Tally yet": "Tally से अभी कुछ नहीं आया",
  "Your balance and bills appear here once SNJ's computer sends them.": "SNJ का कंप्यूटर भेजते ही आपका बैलेंस और बिल यहाँ दिखेंगे।",
  "Balance": "बैलेंस", "in your favour": "आपके पक्ष में", "to pay SNJ": "SNJ को देना है", "Overdue": "तारीख निकल चुकी रकम",
  "oldest {n} days late": "सबसे पुराना {n} दिन देर", "nothing overdue": "कुछ बकाया नहीं", "Credit limit": "क्रेडिट लिमिट",
  "over the limit by {a}": "लिमिट से {a} ज़्यादा", "{a} still available": "{a} बाकी", "Last payment": "आखिरी भुगतान",
  "none this year": "इस साल कोई नहीं", "What you owe, by due date": "बकाया, तारीख के हिसाब से", "Not due yet": "अभी तारीख नहीं आई",
  "1–15 days late": "1–15 दिन देर", "16–30 days late": "16–30 दिन देर", "Over 30 days late": "30 दिन से ज़्यादा देर",
  "Plus {a} paid in advance, not yet set against a bill.": "साथ में {a} एडवांस, जो अभी किसी बिल में नहीं लगा।",
  "Bills to pay": "देने वाले बिल", "All bills": "सभी बिल", "Bill no.": "बिल नं.", "Due": "तारीख", "Days late": "दिन देर",
  "To pay ₹": "देना है ₹", "Nothing to pay": "कुछ देना नहीं", "Every bill is paid.": "सभी बिल चुका दिए गए हैं।",
  "Confirm your balance": "अपना बैलेंस कन्फ़र्म करें",
  "SNJ's books show {a} {side} as of {d}. Is that right?": "SNJ के खाते में {d} तक {a} {side}। क्या यह सही है?",
  "You confirmed {a} on {d}.": "आपने {d} को {a} कन्फ़र्म किया।", "On {d} you said it differs: {n}": "{d} को आपने बताया कि अंतर है: {n}",
  "What differs?": "क्या अंतर है?", "Cancel": "रद्द करें", "Yes, it's right": "हाँ, सही है", "No, it differs": "नहीं, अंतर है",
  "To pay": "देना है", "Transport": "ट्रांसपोर्ट", "Paid": "चुका दिया", "Part paid": "कुछ चुकाया", "Not paid": "नहीं चुकाया",
  "{n} days late": "{n} दिन देर", "No bills yet": "अभी कोई बिल नहीं", "Print / save as PDF": "प्रिंट / PDF सेव करें",
  "Statement of account": "खाते का स्टेटमेंट", "Particulars": "विवरण", "Debit ₹": "नामे ₹", "Credit ₹": "जमा ₹", "Balance ₹": "बैलेंस ₹",
  "Opening balance": "शुरुआती बैलेंस", "Closing balance": "आखिरी बैलेंस",
  "Some older vouchers are still being copied from Tally, so this may not add up to the balance yet.": "कुछ पुराने वाउचर अभी Tally से आ रहे हैं, इसलिए जोड़ अभी बैलेंस से मेल न खाए।",
  "Positive balance: to pay SNJ. Negative: in your favour.": "प्लस बैलेंस: SNJ को देना है। माइनस: आपके पक्ष में।",
  "Bill": "बिल", "Payment": "भुगतान", "Credit note": "क्रेडिट नोट", "Debit note": "डेबिट नोट", "Adjustment": "समायोजन", "Refund": "वापसी",
  "Receipt no.": "रसीद नं.", "Against bills": "किन बिलों के लिए", "On account": "खाते में", "Note": "नोट",
  "No payments this year": "इस साल कोई भुगतान नहीं", "Billed this year": "इस साल के बिल", "since {d}": "{d} से",
  "Paid this year": "इस साल भुगतान", "Returns and credit notes": "रिटर्न और क्रेडिट नोट", "Month by month": "महीने के हिसाब से",
  "Billed": "बिल", "Billed to": "बिल किसको", "Vehicle": "गाड़ी", "Qty": "मात्रा", "Rate ₹": "रेट ₹", "Goods": "माल",
  "Tax, freight and rounding": "टैक्स, भाड़ा और राउंडिंग", "Bill total": "कुल बिल",
  "A copy of the bill as recorded in SNJ's Tally. The signed tax invoice is the original.": "यह SNJ के Tally में दर्ज बिल की कॉपी है। साइन किया हुआ टैक्स इनवॉइस ही असली है।",
  "Recent bills": "हाल के बिल", "see bills to pay": "देने वाले बिल देखें",
  // news and catalogue
  "Schemes, offers and news from SNJ": "SNJ की स्कीम, ऑफ़र और खबरें", "Nothing yet": "अभी कुछ नहीं",
  "New schemes and news from SNJ will appear here.": "SNJ की नई स्कीम और खबरें यहाँ दिखेंगी।",
  "The latest from SNJ": "SNJ का नया माल", "Open": "खोलें", "No catalogues yet": "अभी कोई कैटलॉग नहीं",
  "New collections will appear here.": "नए कलेक्शन यहाँ दिखेंगे।",
};

export const LangContext = createContext({ lang: "en", setLang: () => {} });

const fill = (s, vars) => s.replace(/\{(\w+)\}/g, (_, k) => (vars && k in vars ? vars[k] : `{${k}}`));

// t("Namaste, {name}", { name }) -> the Hindi when Hindi is on and known, else the English.
export function useT() {
  const { lang } = useContext(LangContext);
  return (s, vars) => fill(lang === "hi" && HI[s] ? HI[s] : s, vars);
}

export function useLang() {
  return useContext(LangContext);
}

export function savedLang() {
  try {
    return localStorage.getItem("snj-lang") === "hi" ? "hi" : "en";
  } catch {
    return "en";
  }
}

export function saveLang(lang) {
  try {
    localStorage.setItem("snj-lang", lang);
  } catch { /* private window: it just won't be remembered */ }
}
