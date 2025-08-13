/*
 Signpost Publishing Script (SPS)
 by Evad37
 Forked by JPxG, 2022
 ------------
 Note 1: This script will only run for users specified in the publishers array.
 ------------
 Note 2: This script assumes users have the following permissions - you must request them if you do
 not already have them. THIS IS IMPORTANT! THE SCRIPT WILL EAT SHIT AND MESS UP THE ISSUE IF YOU RUN IT WITHOUT THEM!
 * Page mover (or administrator) on English Wikipedia
   - This ensures redirects are not left behind when moving pages during publication.
 * Mass message sender (or administrator) on English Wikipedia
   - This allows posting the Signpost on the talkpages of English Wikipedia subscribers.
 * Mass message sender (or administrator) on Meta
   - This allows posting the Signpost on the talkpages of subscribers on other projects.


*/
/* jshint esversion: 6, esnext:false, laxbreak: true, undef: true, maxerr: 999 */
/* globals console, window, document, $, mw, OO, extraJs */
// <nowiki>

/* ========== Dependencies and initial checks =================================================== */
$.when(
  mw.loader.using([
    'mediawiki.util', 'mediawiki.api',
    'oojs-ui-core', 'oojs-ui-widgets', 'oojs-ui-windows'
  ]),
  $.getScript('/w/index.php?title=User:R1F4T/libExtraUtil.js&action=raw&ctype=text/javascript'),
  $.ready
).then(function() {

function bnDate(date = new Date()) {
  return libExtraUtil.getBengaliMonthYear(date);
}

var atNewsroom = mw.config.get('wgPageName').includes('উইকিপিডিয়া:উইকিপত্রিকা/বার্তাকক্ষ'); 
if ( !atNewsroom ) {
	return;
}
var publishers = ['R1F4T','Mehedi Abedin','খাত্তাব হাসান'];
var isApprovedUser = ( publishers.indexOf(mw.config.get('wgUserName')) !== -1 );
if ( !isApprovedUser ) {
	return;
}
// Script version and API config options
var scriptVersion = '1.0';
var apiConfig = {ajax: {headers: {'Api-User-Agent': 'SignpostPublishingScript/' + scriptVersion + ' ( https://bn.wikipedia.org/wiki/User:R1F4T/SPS )'} } };
window.SPSdebug = true;

//On first run after page load, clear the cache in window.localStorage
try {
	window.localStorage.setItem('SignpostPubScript-titles', '');
	window.localStorage.setItem('SignpostPubScript-selected-titles', '');
	window.localStorage.setItem('SignpostPubScript-previousIssueDates', '');
	window.localStorage.setItem('SignpostPubScript-info', '');
	window.localStorage.setItem('SignpostPubScript-startAtZero', '');
} catch(e) {}

/* ============================== Styles ============================================ */
mw.util.addCSS(
	'.SPS-dialog-heading { font-size: 115%; font-weight: bold; text-align: center; margin: -0.2em 0 0.2em; }'+
	'.SPS-dryRun { display: none; font-size: 88%; margin-left: 0.2em; }'+
	'.SPS-dialog-DraggablePanel { margin: 0.5em 0; }'+
	'.SPS-dialog-DraggablePanel .oo-ui-fieldLayout.oo-ui-fieldLayout-align-left > .oo-ui-fieldLayout-body > .oo-ui-fieldLayout-header { display: none; }'+
	'.SPS-dialog-item-section { font-weight: bold; }'+
	'.SPS-dialog-item-title { font-size: 92%; color: #333; margin-left: 0.1em; }'+
	'.SPS-dialog-item-blurb { font-size: 85%; color: #333; margin-left: 0.1em; }'+
	'.four ul li.SPS-task-waiting { color: #777; }'+
	'.four ul li.SPS-task-doing { color: #00F; }'+
	'.four ul li.SPS-task-done { color: #0A0; }'+
	'.four ul li.SPS-task-failed { color: #A00; }'+
	'.four ul li.SPS-task-skipped { color: #B0A; }'+
	'.four ul li .SPS-task-status { font-weight: bold; }'+
	'.four ul li .SPS-task-failed .SPS-task-errorMsg { font-weight: bold; }'+
	'.SPS-inlineButton { margin: 0.2em; padding: 0.3em 0.6em; font-size: 0.9em; }'+
	'.no-bold { font-weight: normal; }'
);

/* ========== Utility functions ================================================================= */
/** writeToCache
 * @param {String} key
 * @param {Array|Object} val
 */
var writeToCache = function(key, val) {
	try {
		var stringVal = JSON.stringify(val);
		window.localStorage.setItem('SignpostPubScript-'+key, stringVal);
	} catch(e) {}
};
/** readFromCache
 * @param {String} key
 * @returns {Array|Object|String|null} Cached array or object, or empty string if not yet cached,
 *          or null if there was error.
 */
var readFromCache = function(key) {
	var val;
	try {
		var stringVal = window.localStorage.getItem('SignpostPubScript-'+key);
		if ( stringVal !== '' ) {
			val = JSON.parse(stringVal);
		}
	} catch(e) {
		console.log('[SPS] error reading ' + key + ' from window.localStorage cache:');
		console.log(
			'\t' + e.name + ' message: ' + e.message +
			( e.at ? ' at: ' + e.at : '') +
			( e.text ? ' text: ' + e.text : '')
		);
	}
	return val || null;
};
/** promiseTimeout
 * @param {Number} time - duration of the timeout in miliseconds
 * @returns {Promise} that will be resolved after the specified duration
 */
var promiseTimeout = function(time) {
	var timeout = $.Deferred();
	window.setTimeout(function() { return timeout.resolve(); }, time);
	return timeout;
};
/** reflect
 * @param {Promise|Any} Promise, or a value to treated as the result of a resolved promise
 * @returns {Promise} that always resolves to an object which wraps the values or errors from the
 *          resolved or rejected promise in a 'value' or 'error' array, along with a 'status' of
 *          "resolved" or "rejected"
 */
var reflect = function(promise) {
	var argsArray = function(args) {
		return (args.length === 1 ? [args[0]] : Array.apply(null, args));
	};
	return $.when(promise).then(
		function() { return {'value': argsArray(arguments), status: "resolved" }; },
		function() { return {'error': argsArray(arguments), status: "rejected" }; }
	);
};

/** whenAll
 * Turns an array of promises into a single promise of an array, using $.when.apply
 * @param {Promise[]} promises
 * @returns {Promise<Array>} resolved promises
 */
var whenAll = function(promises) {
	return $.when.apply(null, promises).then(function() {
		return Array.from(arguments);
	});
};

/** getFullUrl
 * @param {String|null} page Page name. Defaults to the value of `mw.config.get('wgPageName')`
 * @param {Object|null} params A mapping of query parameter names to values, e.g. `{action: 'edit'}`
 * @retuns {String} Full url of the page
 */
var getFullUrl = function(page, params) {
	return 'https:' + mw.config.get('wgServer') + mw.util.getUrl( page, params );
};

/** approxPageSize
 * Calculates the approximate size of a page by adding up the size of images,
 * and rounding up to the nearest MB.
 *
 * @param {String} page Name of the page
 * @return {Promise<String>} Size
 */
var approxPageSize = function(page) {
	var url = mw.util.getUrl(page, { useskin: 'vector' });

	return $.get(url).then(function(pageHtml) {
		var doc = document.implementation.createHTMLDocument("Temp");
		doc.documentElement.innerHTML = pageHtml;

		var images = doc.images;
		var estimatedImageSize = 0;

		for (var i = 0; i < images.length; i++) {
			var img = images[i];
			var area = img.naturalWidth * img.naturalHeight;
			if (!isNaN(area)) {
				estimatedImageSize += area * 0.07; // rough 0.07 bytes/pixel
			}
		}

		var totalBytes = estimatedImageSize + (200 * 1024); // Add 200 KB base
		var totalMb = totalBytes / 1024 / 1024;
		var rounded = Math.round(totalMb * 10) / 10;
		return totalMb < 0.1 ? "<0.1&nbsp;MB" : rounded + "&nbsp;MB";
	});
};

var removeHtmlComments = function(wikitext, trim) {
	var newWikitext = wikitext.replace(/<!\-\-(.|\n)*?\-\->/g, '');
	if (window.SPSdebug) {console.log("এইচটিএমএল মন্তব্য মুছে ফেলা হয়েছে");}
	return trim ? newWikitext.trim() : newWikitext;
};

/* ========== Overlay Dialog ==================================================================== */
/* ---------- OverlayDialog class --------------------------------------------------------------- */
// Create OverlayDialog class that inherits from OO.ui.MessageDialog
var OverlayDialog = function( config ) {
	OverlayDialog.super.call( this, config ); 
};
OO.inheritClass( OverlayDialog, OO.ui.MessageDialog );
// Give it a static name property 
OverlayDialog.static.name = 'overlayDialog';
// Override clearMessageAndSetContent method
OverlayDialog.prototype.clearMessageAndSetContent = function(contentHtml) {
	// Find the message label in the dialog
	this.$element.find('label.oo-ui-messageDialog-message')  
	// Insert the new content after it
	.after(
		$('<div>').addClass('oo-ui-overlayDialog-content').append(contentHtml)
	)
    // And empty the original message  
	.empty();
};
// Override getTeardownProcess method
OverlayDialog.prototype.getTeardownProcess = function( data ) {
  // When closing, remove the content div
	this.$element.find('div.oo-ui-overlayDialog-content').remove();
  // Call superclass method  
	return OverlayDialog.super.prototype.getTeardownProcess.call( this, data ); 
};

/* ---------- Window manager -------------------------------------------------------------------- */
/* Factory.
   Makes it easer to use the window manager: Open a window by specifiying the symbolic name of the
   class to use, and configuration options (if any). The factory will automatically crete and add
   windows to the window manager as needed. If there is an old window of the same symbolic name,
   the new version will automatically replace old one.
*/
var ovarlayWindowFactory = new OO.Factory();
ovarlayWindowFactory.register( OverlayDialog );
var ovarlayWindowManager = new OO.ui.WindowManager({ factory: ovarlayWindowFactory });
ovarlayWindowManager.$element.attr('id','SPS-ovarlayWindowManager').addClass('sps-oouiWindowManager').appendTo('body');

/** showOverlayDialog
 * @param {Promise} contentPromise - resolves to {String} of HTML to be displayed
 * @param {String} title - title of overlay dialog
 */
var showOverlayDialog = function(contentWikitext, parsedContentPromise, title, mode) {
	var isWikitextMode = mode && mode.wikitext;
	var contentPromise = ( isWikitextMode ) ?
		$.Deferred().resolve($('<pre>').text(contentWikitext)) : parsedContentPromise;
	var instance = ovarlayWindowManager.openWindow( 'overlayDialog', {
		title: title + ( isWikitextMode ? ' উইকিপাঠ্য' : '' ),
		message: 'লোড করা হচ্ছে...',
		size: 'larger',
		actions: [
			{
				action: 'close',
				label: 'বন্ধ',
				flags: 'safe'
			},
			{
				action: 'toggle',
				label: ( isWikitextMode ? 'প্রাকদর্শন' : 'উইকিপাঠ্য' ) + " দেখুন"
			}
		]
	});
	instance.opened.then( function() {
		contentPromise.done(function(contentHtml) {
			ovarlayWindowManager.getCurrentWindow().clearMessageAndSetContent(contentHtml);
			ovarlayWindowManager.getCurrentWindow().updateSize();
		})
		.fail(function(code, jqxhr) {
			ovarlayWindowManager.getCurrentWindow().clearMessageAndSetContent(
				'প্রাকদর্শন ব্যর্থ।',
				( code == null ) ? '' : extraJs.makeErrorMsg(code, jqxhr)
			);
		});
	});
	instance.closed.then(function(data) {
		if ( !data || !data.action || data.action !== 'toggle' ) {
			return;
		}
		showOverlayDialog(contentWikitext, parsedContentPromise, title, {'wikitext': !isWikitextMode});
	});
};

/* ========== Fake API class ==================================================================== */
// For dry-run mode. Makes real read request to retrieve content, but logs write request to console.
// Also handles previews of content.
var FakeApi = function(apiConfig){
	this.realApi = new mw.Api(apiConfig);
	this.isFake = true;
};
FakeApi.prototype.abort = function() {
	this.realApi.abort();
	console.log('FakeApi was aborted');
};
FakeApi.prototype.get = function(request) {
	return this.realApi.get(request);
};
FakeApi.prototype.preview = function(label, content, title) {
	var self = this;
	$('#SPS-previewButton-container').append(
		$('<button>').addClass('SPS-inlineButton mw-ui-button').text(label).click(function() {
			var parsedContentPromise = self.realApi.post({
				action: 'parse',
				contentmodel: 'wikitext',
				text: content,
				title: title,
				pst: 1,
				prop: 'text'
			})
			.then(function(result) {
				if ( !result || !result.parse || !result.parse.text || !result.parse.text['*'] ){
					return $.Deferred().reject('Empty result');
				}
				return result.parse.text['*'];
			});
		
			showOverlayDialog(content, parsedContentPromise, label);
		})
	);
};
FakeApi.prototype.postWithEditToken = function(request) {
	console.log(request);

	// For occasional failures, for testing purposes, set the first Boolean value to true
	if ( false && Math.random() > 0.8 ) {
		return $.Deferred().reject('Random failure');
	}

	// Show previews for key tasks
	if ( request.title && request.title === 'উইকিপিডিয়া:উইকিপত্রিকা' ) {
		var previewMainWikitext = request.text
			.replace( // Use preview version of header
				"{{subst:উইকিপিডিয়া:উইকিপত্রিকা/টেমপ্লেট/মূল পাতা শীর্ষ}}",
				"{{#invoke:উইকিপত্রিকা/মূল পাতা শীর্ষ প্রাকদর্শন|top}}"
			)
			.replace( // Use today's date
				new RegExp(mw.util.escapeRegExp("{{উইকিপিডিয়া:উইকিপত্রিকা/টেমপ্লেট/সংখ্যা|1}}"),"g"),
				bnDate().month + ' ' + bnDate().year
			);
		this.preview('মূল পাতার প্রাকদর্শন', previewMainWikitext, request.title);
	} else if (
		request.action &&
		request.action === 'massmessage' &&
		request.spamlist === 'Global message delivery/Targets/Signpost'
	) {
		var previewMassMsgWikitext = '{{Fake heading|1=' + request.subject + '}}\n' + request.message;
		this.preview('গণবার্তার প্রাকদর্শন', previewMassMsgWikitext, 'User talk:Example');	
	}

	return promiseTimeout(500).then(function() {
		return {'action': {'result': 'Success'}};
	});
};

/* ========== Pre-publishing tasks / API requests =============================================== */
/** getArticleTitles
 * Find page titles of next edition's articles.
 * @param {Object} api - real or fake API
 * @returns {Promise} of an {Array} of page titles
 */
var getArticleTitles = function(api) {
	if (window.SPSdebug) {console.log("পরবর্তী সংখ্যা থেকে পাতাসমূহ সংগ্রহের চেষ্টা চলছে।");}
	return api.get({
		action: 'query',
		generator: 'allpages',
		gapprefix: 'উইকিপত্রিকা/পরবর্তী সংখ্যা/',
		gapnamespace: 4,
		gapfilterredir: 'nonredirects',
		gaplimit: 'max',
		indexpageids: 1
	})
	.then(function(result) {
		if (window.SPSdebug) {console.log("... সংগ্রহ করা হয়েছে!");}
		return $.map(result.query.pages, function(page) {
			return page.title;
		});
	});
};

/** getPreviousIssueDates
 * Get the previous issue date that each section ran it.
 * @param {Object} api - real or fake API
 * @param {Number} year - the current year
 * @returns {Promise} of an {Object} of 'section':'previous issue date' pairs
 */
// This Function Should not be changed atleast for now. For Now it's working fine
var getPreviousIssueDates = function(api, year) {
  if (window.SPSdebug) {console.log("পূর্ববর্তী সংখ্যা প্রকাশের তারিখগুলো সংগ্রহের চেষ্টা চলছে");}
  
  // Define Bengali months order for sorting:
  const bnMonthsOrder = [
    "বৈশাখ", "জ্যৈষ্ঠ", "আষাঢ়", "শ্রাবণ", "ভাদ্র", "আশ্বিন",
    "কার্তিক", "অগ্রহায়ণ", "পৌষ", "মাঘ", "ফাল্গুন", "চৈত্র"
  ];
  
  function getMonthIndex(month) {
    return bnMonthsOrder.indexOf(month);
  }
  
  // Convert Bengali digits to English for sorting years:
  function en(numBn) {
    const bnNums = "০১২৩৪৫৬৭৮৯";
    return numBn.split("").map(ch => bnNums.indexOf(ch)).join("");
  }
  
  return api.get({
    action: 'query',
    list: 'allpages',
    apnamespace: 4,
    apfilterredir: 'nonredirects',
    apminsize: '1500',
    aplimit: '500',
    apdir: 'descending',
    apprefix: "উইকিপত্রিকা/",
    indexpageids: 1
  }).then(function(result) {
    if (window.SPSdebug) {console.log("...সংগ্রহ করা হয়েছে!");}
    const pages = result.query.allpages;

    // Filter and map valid titles only
    let filteredPages = pages
      .map(page => {
        const title = page.title;
        // Extract after prefix
        const afterPrefix = title.split("উইকিপিডিয়া:উইকিপত্রিকা/")[1];
        if (!afterPrefix) return null;

        const parts = afterPrefix.split("/");
        if (parts.length < 2) return null;

        // parts[0] = "<month> <year>", parts[1] = section
        const monthYear = parts[0].trim();
        const section = parts[1].trim();

        // Extract month and year separately from monthYear (e.g. "মাঘ ১৪৩১")
        const myMatch = monthYear.match(/^(\S+)\s+(\S+)$/);
        if (!myMatch) return null;

        const month = myMatch[1];
        const year = myMatch[2];

        if (bnMonthsOrder.indexOf(month) === -1) return null;

        return { title, month, year, section, monthYear };
      })
      .filter(x => x !== null);

    // Sort by year (desc) and month (desc)
    filteredPages.sort((a, b) => {
      // Year descending
      const yA = Number(en(a.year));
      const yB = Number(en(b.year));
      if (yA !== yB) return yB - yA;

      // Month descending
      return getMonthIndex(b.month) - getMonthIndex(a.month);
    });

    // Build the final object { section: "month year" }
    const prevIssueDates = {};
    filteredPages.forEach(({ section, monthYear }) => {
      // Keep only first/latest occurrence per section
      if (!(section in prevIssueDates)) {
        prevIssueDates[section] = monthYear;
      }
    });

    return prevIssueDates;
  });
};

// getPreviousIssueDates(new mw.Api(), "১৪৩৩").then(function(previousIssueDates) {
// 	console.log(previousIssueDates);
// 	// You can now use `previousIssueDates` here
// });

/** getPageInfo
 * Get article information for a particular article, to be used for snippets etc. Used by #getInfo
 *
 * @param {Object} page Page information from Api query with prop: 'revisions', rvprop: 'content'
 * @returns {Promise<Object>} Relevant page information in key:value pairs
 */
var getPageInfo = function(page) {
	if (window.SPSdebug) {console.log(page.title + " থেকে তথ্য সংগ্রহ করা হচ্ছে");}
	// Page size approximation (promise)
	var sizePromise = approxPageSize(page.title);
    console.log(sizePromise);
	var wikitext = page.revisions[ 0 ][ '*' ];

	var templates = extraJs.parseTemplates(wikitext);
	// Title and blurb from Signpost draft template
	var draftTemplate = templates.find(t => t.name === 'উইকিপত্রিকা খসড়া');
	var title = draftTemplate && draftTemplate.getParam('শিরোনাম') && draftTemplate.getParam('শিরোনাম').value || '';
	var blurb = draftTemplate && draftTemplate.getParam('ব্লার্ব') && draftTemplate.getParam('ব্লার্ব').value || '';
	// Begin extraction of piccy params - JPxG, 2023 Dec 22
	var piccyfilename = draftTemplate && draftTemplate.getParam('piccyfilename') && draftTemplate.getParam('piccyfilename').value || '';
	var piccycredits  = draftTemplate && draftTemplate.getParam('piccy-credits') && draftTemplate.getParam('piccy-credits').value || '';
	var piccylicense  = draftTemplate && draftTemplate.getParam('piccy-license') && draftTemplate.getParam('piccy-license').value || '';
	var piccyscaling  = draftTemplate && draftTemplate.getParam('piccy-scaling') && draftTemplate.getParam('piccy-scaling').value || '';
	var piccyxoffset  = draftTemplate && draftTemplate.getParam('piccy-xoffset') && draftTemplate.getParam('piccy-xoffset').value || '';
	var piccyyoffset  = draftTemplate && draftTemplate.getParam('piccy-yoffset') && draftTemplate.getParam('piccy-yoffset').value || '';
	// End hackjob

	// RSS feed description from the RSS description template,
	// or use title and blurb instead if no rss description is found
	var rssTemplate = templates.find(t => t.name === 'উইকিপিডিয়া:উইকিপত্রিকা/টেমপ্লেট/আরএসএস বিবরণ');
	var rss = ( rssTemplate && rssTemplate.getParam('1') && rssTemplate.getParam('1').value && removeHtmlComments(rssTemplate.getParam('1').value, true) ) ||
		removeHtmlComments(title, true) + ': ' + removeHtmlComments(blurb, true);

	// Begin hackjob by JPxG to parse "by" params out of header template, 2023 Dec 3
	var headerTemplate = templates.find( t => t.name === 'উইকিপিডিয়া:উইকিপত্রিকা/টেমপ্লেট/উইকিপত্রিকা-প্রবন্ধ-শীর্ষ-স২' || t.name === 'উইকিপিডিয়া:উইকিপত্রিকা/টেমপ্লেট:উইকিপত্রিকা-প্রবন্ধ-শুরু');
	var by = headerTemplate && headerTemplate.getParam('2') && headerTemplate.getParam('2').value || '';

	by = by.toLowerCase().startsWith("by ") ? by.slice(3) : by;

	// End hackjob

	return sizePromise.then(function(size) {
		return {
			'pageid'       : page.pageid,
			'section'      : page.title.slice(39), // slice removes "Wikipedia:Wikipedia Signpost/পরবর্তী সংখ্যা/" (doing it this way is asking for trouble btw)
			'title'        : removeHtmlComments(title, true),
			'blurb'        : removeHtmlComments(blurb, true),
			'rss'          : removeHtmlComments(rss, true),
			'wikitext'     : wikitext,
			'templates'    : templates,
			'size'         : size, 	
			'by'           : removeHtmlComments(by, true),
			'piccyfilename': removeHtmlComments(piccyfilename, true),
			'piccycredits': removeHtmlComments(piccycredits, true),
			'piccylicense': removeHtmlComments(piccylicense, true),
			'piccyscaling': removeHtmlComments(piccyscaling, true),
			'piccyxoffset': removeHtmlComments(piccyxoffset, true),
			'piccyyoffset': removeHtmlComments(piccyyoffset, true)
		};
	});
};

/** getInfo
 * Get article information for each section, to be used for snippets etc
 * @param {Object} api - real api or fake api
 * @param {Array} pagetitles
 * @param {Object} prevIssueDates - object with 'section':'previous issue date' pairs
 * @returns Promise of an Array of Objects
 */
var getInfo = function(api, pagetitles, prevIssueDates) {
	if (window.SPSdebug) {console.log("পাতার শিরোনামের জন্য তথ্য সংগ্রহ করা হচ্ছে।");}
	return api.get({
		action: 'query',
		titles: pagetitles,
		prop: 'revisions',
		rvprop: 'content',
		indexpageids: 1
	})
	.then(function(result) {
		var infoPromises = $.map(result.query.pages, getPageInfo);
		return whenAll(infoPromises);
	})
	.then(function(infos) {
		return infos.map(function(info) {
			info.prev = prevIssueDates[info.section] || '';
			return info;
		});
	});
};

/* ========== Publishing tasks / API requests =================================================== */
// Step 0:
/** makeIssuePage
 * Creates the main issue page
 * @param {Object} data - configuration and other data, including
 *   @param {Object} data.api -- real api for editing, or fake api for logging proposed edit
 *   @param {Object} data.today
 *     @param {String} data.today.iso
 *   @param {String} data.script_ad
 *   @param {Array} data.articles
 *   @param {Number} data.firstItemIndex - 0 if there is a "From the editor(s)" section, otherwise 1
 *
 * @returns Promise of a success or failure message
 */
var makeIssuePage = function(data) {
	if (window.SPSdebug) {console.log("সংখ্যার জন্য পাতা তৈরি করা হচ্ছে।");}
	var toCoverItem = function(article, index) {
		var strToRet;
		strToRet = "{{উইকিপত্রিকা/আইটেম|{{{1}}}|";
		strToRet += (index+data.firstItemIndex);
		strToRet += "|"               + data.today.iso;
		strToRet += "|"               + article.section;
		strToRet += "|"               + article.title;
		strToRet += "|"               + article.size;
		strToRet += "|sub="           + article.blurb;
		strToRet += "|by="            + article.by;
		strToRet += "|piccyfilename=" + article.piccyfilename;
		strToRet += "|piccy-credits=" + article.piccycredits;
		strToRet += "|piccy-license=" + article.piccylicense;
		strToRet += "|piccy-scaling=" + article.piccyscaling;
		strToRet += "|piccy-xoffset=" + article.piccyxoffset;
		strToRet += "|piccy-yoffset=" + article.piccyyoffset;
		strToRet += "}}\n";
		return strToRet;
		// This looks like it's the main page but it's not -- it's for the issue archive page!
	};
	if (window.SPSdebug) {console.log("... তৈরি করা হয়েছে, এখন সংরক্ষণের চেষ্টা করা হচ্ছে।");}
	return data.api.postWithEditToken({
		action: 'edit',
		title: data.path + "/" + data.today.iso,
		text: data.articles.map(toCoverItem).join(''),
		summary: data.script_ad + "নতুন সংস্করণ" 
	});
};

// Step 1:

/** cleanupWikitext
 * Prepare wikitext of an article for publication (remove draft template, add/edit footer template, replace /পরবর্তী সংখ্যা/ with date)
 * Used by #prepareArticles
 * @param {Object} article Data from #getInfo
 * @returns {String} wikitext for publication
 */
var cleanupWikitext = function(article) {
	if (window.SPSdebug) {console.log("উইকিপাঠ্য পরিস্কার করা হচ্ছে।");}
	// Replacement wikitext for top noinclude section
	var new_topNoincludeSection = "<noinclude>{{উইকিপিডিয়া:উইকিপত্রিকা/টেমপ্লেট/আরএসএস বিবরণ|1=" +
		article.rss + "}}{{উইকিপিডিয়া:উইকিপত্রিকা/টেমপ্লেট:উইকিপত্রিকা শীর্ষ|||}}</noinclude>";

	// Replacement wikitext for article header template
	var articleHeaderTemplate = article.templates.find( t => t.name === 'উইকিপিডিয়া:উইকিপত্রিকা/টেমপ্লেট/উইকিপত্রিকা-প্রবন্ধ-শীর্ষ-স২' || t.name === 'উইকিপিডিয়া:উইকিপত্রিকা/টেমপ্লেট:উইকিপত্রিকা-প্রবন্ধ-শুরু');
	var new_headerWikitext = articleHeaderTemplate && articleHeaderTemplate.wikitext.replace(articleHeaderTemplate.getParam('1').wikitext, '|' + "{{{1|" + article.title + "}}}");
	// Add piccy params to the new header wikitext
	var new_headerExtraParams = "";
	new_headerExtraParams += "\n|piccyfilename = " + article.piccyfilename;
	new_headerExtraParams += "\n|piccy-credits = " + article.piccycredits;
	new_headerExtraParams += "\n|piccy-license = " + article.piccylicense;
	new_headerExtraParams += "\n|piccy-xoffset = " + article.piccyxoffset;
	new_headerExtraParams += "\n|piccy-yoffset = " + article.piccyyoffset;
	new_headerExtraParams += "\n|piccy-scaling = " + article.piccyscaling;
	new_headerWikitext = new_headerWikitext.slice(0, -2) + new_headerExtraParams + "\n}}";
	
	// Replacement wikitext for article footer template
	var footerTemplate = article.templates.find(t => t.name === 'উইকিপিডিয়া:উইকিপত্রিকা/টেমপ্লেট/উইকিপত্রিকা-প্রবন্ধ-মন্তব্য-শেষ' || t.name === 'Wikipedia:Wikipedia Signpost/Templates/Signpost-article-comments-end');
	var new_footerWikitext = "{{উইকিপিডিয়া:উইকিপত্রিকা/টেমপ্লেট/উইকিপত্রিকা-প্রবন্ধ-মন্তব্য-শেষ||" + article.prev + "|}}";

	// Signpost draft helper template - to be removed
	var helperTemplate = article.templates.find(t => t.name === 'উইকিপত্রিকা খসড়া সাহায্যকারী');
	var helperPatt = ( helperTemplate )
		? new RegExp('\\n?'+mw.util.escapeRegExp(helperTemplate.wikitext))
		: null;
	var today = bnDate().month + ' ' + bnDate().year;
	var updatedWikitext = article.wikitext
		.replace(helperPatt, '')
		.replace(/<noinclude>(?:.|\n)*?<\/noinclude>/, new_topNoincludeSection)
		.replace(articleHeaderTemplate && articleHeaderTemplate.wikitext, new_headerWikitext)
		.replaceAll("/পরবর্তী সংখ্যা", "/" + today)
		.replaceAll("/পরবর্তী_সংখ্যা", "/" + today);
	if ( footerTemplate ) {
		if (window.SPSdebug) {console.log("... পরিষ্কার করা হয়েছে (পাদলেখ টেমপ্লেট পাওয়া গেছে)।");}
		return updatedWikitext.replace(footerTemplate.wikitext, new_footerWikitext);
	} else {
		if (window.SPSdebug) {console.log("... পরিষ্কার করা হয়েছে (পাদলেখ টেমপ্লেট পাওয়া যায়নি)।");}
		return updatedWikitext.trim() + "\n<noinclude>" + new_footerWikitext + "</noinclude>";
	}
};
/** prepareArticles
 * Edit each article to prepare it for publication (remove draft template, add/edit footer template)
 * @param {Object} data - configuration and other data, including
 *   @param {Object} data.api - real api for editing, or fake api for logging proposed edit
 *   @param {String} data.script_ad
 *   @param {Array} data.articles
 * @returns {Promise} resolved if edits were successfull, or rejected with a failure message
 */
var prepareArticles = function(data) {
	if (window.SPSdebug) {console.log("নিবন্ধসমূহ প্রস্তুত করার চেষ্টা করা হচ্ছে।");}
	var editedArticlesPromises = data.articles.map(function(article) {
		if (window.SPSdebug) {console.log("... " + article.pageid + " পাতার আইডি পরীক্ষা করা হচ্ছে।");}
		return data.api.postWithEditToken({
			action: 'edit',
			pageid: article.pageid,
			text: cleanupWikitext(article),
			summary: data.script_ad + "প্রকাশের জন্য প্রস্তুত কয়া হচ্ছে।"
		});
	});
	return whenAll(editedArticlesPromises);
};

// Step 2:
var maxMovesPerMinute = 1; // Var placed outside function for reuse in dialog status panel
// asinine hack from jpxg 2025-05-14: this is erroring out a lot so i'm just going to set it to 1, e.g. make the batch size one
// then edit "minutesBetweenMoveBatches" to set timeouts for each move. for some reason batching them all is just being a pain in the ass idk why
/**
 * moveArticles
 *
 * Move each article to the new issue subpage
 *
 * @param {Object} data - configuration and other data, including
 *   @param {Object} data.api -- real api for editing, or fake api for logging proposed edit
 *   @param {String} data.path
 *   @param {Object} data.today
 *     @param {String} data.today.iso
 *   @param {String} data.script_ad
 *   @param {Array} data.articles
 *
 * @returns Promise of a success or failure message
 */
var moveArticles = function(data) {
	if (window.SPSdebug) {console.log("স্থানান্তরের চেষ্টা করা হচ্ছে।");}
	var minutesBetweenMoveBatches = 0.26; // The extra 0.1 is a safety factor.
	var millisecondsBetweenMoveBatches = minutesBetweenMoveBatches * 60 * 1000;
	var movedArticlesPromises = data.articles.map(function(article, index) {
		var numberAlreadyMoved = index;
		var sleepMilliseconds = Math.floor(numberAlreadyMoved/maxMovesPerMinute) * millisecondsBetweenMoveBatches;
		return promiseTimeout(sleepMilliseconds).then(function() {
			if (window.SPSdebug) {
				console.log("... " + article.pageid + " পাতার আইডি স্থানান্তর করা হচ্ছে।");
				console.log("পুরাতন শিরোনাম: " + data.path + "/পরবর্তী সংখ্যা/"             + article.section);
				console.log("নতুন শিরোনাম: " + data.path + "/" + data.today.iso + "/" + article.section);
			}
			return data.api.postWithEditToken({
				action: 'move',
				fromid: article.pageid,
				to: data.path + "/" + data.today.iso + "/" + article.section,
				noredirect: 1,
				reason:  data.script_ad + 'প্রকাশ করা হচ্ছে' 
			});
		});
	});
	return whenAll(movedArticlesPromises);
};

// Step 3:
/**
 * editIssueSubpage
 *
 * Update the page "উইকিপিডিয়া:উইকিপত্রিকা/টেমপ্লেট/সংখ্যা"
 *
 * @param {Object} data -- configuration and other data, including
 *   @param {Object} data.api -- real api for editing, or fake api for logging proposed edit
 *   @param {String} data.path
 *   @param {Object} data.today
 *     @param {String} data.today.iso
 *   @param {String} data.script_ad
 *
 * @returns Promise of both the previous date in ISO format, and a success or failure message
 */
var editIssueSubpage = function(data) {
	if (window.SPSdebug) {console.log("উইকিপিডিয়া:উইকিপত্রিকা/টেমপ্লেট/সংখ্যা হালনাগাদ করার চেষ্টা করা হচ্ছে।");}
	return data.api.get({
		action: 'query',
		titles: 'উইকিপিডিয়া:উইকিপত্রিকা/টেমপ্লেট/সংখ্যা',
		prop: 'revisions',
		rvprop: 'content',
		indexpageids: 1
	})
	.then(function(result) {
		var pid = result.query.pageids[0];
		var oldWikitext = result.query.pages[pid].revisions[ 0 ]['*'];
		// Update the YYYY-MM-DD dates
		var oldDates = oldWikitext.match(/(বৈশাখ|জ্যৈষ্ঠ|আষাঢ়|শ্রাবণ|ভাদ্র|আশ্বিন|কার্তিক|অগ্রহায়ণ|পৌষ|মাঘ|ফাল্গুন|চৈত্র)\s+[০-৯]{3,4}/g);
		var wikitext = oldWikitext.replace(oldDates[0], data.today.iso)
			.replace(oldDates[1], oldDates[0]);
		//Store previous edition date for later use
		var previous_iso = oldDates[0];
		//Get the current volume and issue numbers
		var edition, vol, iss;
		var edition_patt = /বর্ষ ([০-৯]+), সংখ্যা ([০-৯]+)/;
		//If the previous edition was last year, increment volume and reset issue number to 1
		if ( parseInt( en(previous_iso.slice(-4) )) < parseInt(en(data.today.year)) ) {
			edition = (edition_patt.exec(wikitext));
			vol = (parseInt(edition[1])+1).toString();
			iss = "১";
		} else { //increment issue number
			edition = edition_patt.exec(wikitext);
			vol = edition[1];
			iss = bn((parseInt(Number(en(edition[2])))+1).toString());
		}
		//update volume and issue numbers
		return $.Deferred().resolve(
			wikitext.replace(/বর্ষ ([০-৯]+), সংখ্যা ([০-৯]+)/, "বর্ষ " + bn(vol) + ", সংখ্যা " + iss ),
			{"previousIssueDate": previous_iso, "vol": bn(vol), "iss": bn(iss)}
		);
	})
	.then(function(wikitext, editionInfo) {
		if (window.SPSdebug) {console.log("... সম্পাদনা হালনাগাদ করার চেষ্টা করা হচ্ছে।");}
		var editPromise = data.api.postWithEditToken({
			action: 'edit',
			title: data.path + "/টেমপ্লেট/সংখ্যা",
			text: wikitext,
			summary: data.script_ad + "নতুন সংস্করণ প্রকাশ করা হচ্ছে।"
		});
		return $.when(editPromise, editionInfo);
	});
};

// Step 4:
/**
 * editMain
 *
 * Edit the main Signpost page
 *
 * @param {Object} data -- configuration and other data, including
 *   @param {Object} data.api -- real api for editing, or fake api for logging proposed edit
 *   @param {String} data.path
 *   @param {String} data.script_ad
 *   @param {Array} data.articles
 *
 * @returns Promise of a success or failure message
 */
var editMain = function(data) {
	if (window.SPSdebug) {console.log("উইকিপত্রিকা মূল পাতা হালনাগাদ করার চেষ্টা করা হচ্ছে।");}
	var topwikitext = "{{subst:উইকিপিডিয়া:উইকিপত্রিকা/টেমপ্লেট/মূল পাতা শীর্ষ}}\n\n";
	var bottomwikitext = "{{subst:উইকিপিডিয়া:উইকিপিডিয়া:উইকিপত্রিকা/টেমপ্লেট/মূল পাতা পাদলেখ}}";
	var midwikitext = data.articles.map(function(article) {
		var strToRet = "{{উইকিপত্রিকা/সমাহার";
		strToRet += "|{{উইকিপিডিয়া:উইকিপত্রিকা/টেমপ্লেট/সংখ্যা|১}}";
		strToRet += "|"               + article.section;
		strToRet += "|"               + article.title;
		strToRet += "|"               + article.blurb;
		strToRet += "|"               + article.size;
		strToRet += "|sub="           + article.size;
		strToRet += "|by="            + article.by;
		strToRet += "|piccyfilename=" + article.piccyfilename;
		strToRet += "|piccy-credits=" + article.piccycredits;
		strToRet += "|piccy-license=" + article.piccylicense;
		strToRet += "|piccy-scaling=" + article.piccyscaling;
		strToRet += "|piccy-xoffset=" + article.piccyxoffset;
		strToRet += "|piccy-yoffset=" + article.piccyyoffset;
		strToRet += "}}\n\n";
		return strToRet;
		// This looks like it's the issue archive page but it's not -- it's for the main page!
	});
	if (window.SPSdebug) {console.log("... সম্পাদনা সংরক্ষণ করার চেষ্টা করা হচ্ছে।");}
	return data.api.postWithEditToken({
		action: 'edit',
		title: data.path,
		text: topwikitext + midwikitext.join('') + bottomwikitext,
		summary:  data.script_ad + "নতুন সংস্করণ প্রকাশ করা হচ্ছে।"
	});

};

// Step 5:
/**
 * makeSingle
 *
 * Create the single page edition
 *
 * @param {Object} data -- configuration and other data, including
 *   @param {Object} data.api -- real api for editing, or fake api for logging proposed edit
 *   @param {String} data.path
 *   @param {Object} data.today
 *     @param {String} data.today.iso
 *   @param {String} data.script_ad
 *
 * @returns Promise of a success or failure message
 */
var makeSingle = function(data) {
	if (window.SPSdebug) {console.log("দেয়ালিকা পাতা সংরক্ষণ করার চেষ্টা করা হচ্ছে।");}
	return data.api.postWithEditToken({
		action: 'edit',
		title: data.path + "/দেয়ালিকা/" + data.today.iso,
		text: "{{উইকিপিডিয়া:উইকিপত্রিকা/দেয়ালিকা|issuedate=" + data.today.iso + "}}",
		summary: data.script_ad + "নতুন দেয়ালিকা পাতা সংস্করণ প্রকাশ করা হচ্ছে।"
	});
};

// Step 6:
/**
 * makeArchive
 *
 * Create this issue's archive page
 *
 * @param {Object} data -- configuration and other data, including
 *   @param {Object} data.api -- real api for editing, or fake api for logging proposed edit
 *   @param {String} data.path
 *   @param {Object} data.today
 *     @param {String} data.today.iso
 *   @param {String} data.script_ad
 *   @param {String} data.previousIssueDate -- in ISO format
 *
 * @returns Promise of a success or failure message
 */
var makeArchive = function(data) {
	if ( !data.previousIssueDate ) {
		return $.Deferred().reject('পূর্ববর্তী সংখ্যার তারিখ খুঁজে পাওয়া যায়নি।');
	}
	if (window.SPSdebug) {console.log("আর্কাইভ পাতা সংরক্ষণের চেষ্টা করা হচ্ছে।");}
	return data.api.postWithEditToken({
		action: 'edit',
		title: data.path + "/আর্কাইভ/" + data.today.iso,
		text: "{{উইকিপত্রিকা আর্কাইভ|" + data.previousIssueDate + "|" + data.today.iso + "|}}",
		summary: data.script_ad + "নতুন দেয়ালিকা পাতা সংস্করণ প্রকাশ করা হচ্ছে।"
	});
};

// Step 7:
/**
 * updatePrevArchive
 *
 * Update the previous issue's archive page with the next edition date
 *
 * @param {Object} data -- configuration and other data, including
 *   @param {Object} data.api -- real api for editing, or fake api for logging proposed edit
 *   @param {String} data.path
 *   @param {Object} data.today
 *     @param {String} data.today.iso
 *   @param {String} data.script_ad
 *   @param {String} data.previousIssueDate -- in ISO format
 *
 * @returns Promise of a success or failure message
 */
var updatePrevArchive = function(data) {
	if ( !data.previousIssueDate ) {
		return $.Deferred().reject('পূর্ববর্তী সংখ্যার তারিখ খুঁজে পাওয়া যায়নি।');
	}
	if (window.SPSdebug) {console.log("পূর্ববর্তী আর্কাইভ পাতা সংরক্ষণের চেষ্টা করা হচ্ছে।");}
	return data.api.get({
		action: 'query',
		titles: data.path + "/আর্কাইভ/" + data.previousIssueDate,
		prop: 'revisions',
		rvprop: 'content',
		indexpageids: 1
	})
	.then(function(result) {
		var pid = result.query.pageids[0];
		var wikitext = result.query.pages[pid].revisions[ 0 ]['*'];
		return wikitext.replace(/\|?\s*}}/, "|" + data.today.iso + "}}");
	})
	.then(function(wikitext) {
		if (window.SPSdebug) {console.log("... পাতা সংরক্ষণের চেষ্টা করা হচ্ছে।");}
		return data.api.postWithEditToken({
			action: 'edit',
			title: data.path + "/আর্কাইভ/" + data.previousIssueDate,
			text: wikitext,
			summary: data.script_ad + " পরবর্তী সংস্করণের তারিখ যোগ করা হলো"
		});
	});
};

// Step 8:
/**
 * purgePages
 *
 * Purge pages to ensure that latest versions are shown, following all the edits and page moves
 *
 * @param {Object} data -- configuration and other data, including
 *   @param {Object} data.api -- real api for purging, or fake api for logging proposed purge
 *   @param {String} data.path
 *   @param {Object} data.today
 *     @param {String} data.today.iso
 *   @param {Array} data.articles
 *
 * @returns Promise of a success or failure message
 */
var purgePages = function(data) {
	if (window.SPSdebug) {console.log("পাতাসমুহ শোধন করা হচ্ছে।");}
	var purgetitles = data.articles.map(function(article) {
		return data.path + "/" + data.today.iso + "/" + article.section;
	})
	.concat([
		"উইকিপিডিয়া:উইকিপত্রিকা/টেমপ্লেট/সংখ্যা",
		"উইকিপিডিয়া:উইকিপত্রিকা",
		"উইকিপিডিয়া:উইকিপত্রিকা/সাময়িকী",
		data.path + "/আর্কাইভ/" + data.today.iso,
		"উইকিপিডিয়া:উইকিপত্রিকা/" + data.today.iso
	]);

	return data.api.postWithEditToken({
		action: 'purge',
		titles: purgetitles
	});
};

// Step 9:
/**
 * massmsg
 *
 * Mass-message enwiki subscribers
 *
 * @param {Object} data -- configuration and other data, including
 *   @param {Object} data.api -- real api for editing, or fake api for logging proposed edits
 *   @param {String} data.path
 *   @param {Object} data.today
 *     @param {String} data.today.iso
 *     @param {String} data.today.dmy
 *   @param {String} data.script_page
 *   @param {String} data.vol -- Volume number of current issue
 *   @param {String} data.iss -- Issue number of current issue
 *
 * @returns Promise of a success or failure message
 */
var massmsg = function(data) {
	if (window.SPSdebug) {console.log("Attempting to compose MassMessage.");}
	var vol = data.vol || '';
	var iss = data.iss || '';
	var msg_spamlist = data.path + "/গ্রাহক তালিকা";
	var msg_content = '<div lang="bn" dir="ltr" class="mw-content-ltr"><div style="column-count:2;"> '+
	'{{উইকিপিডিয়া:উইকিপত্রিকা/' + data.today.iso + '}} </div><!--বর্ষ ' + vol + ', সংখ্যা ' + iss + '--> '+
	'<div class="hlist" style="margin-top:10px; font-size:90%; padding-left:5px; font-family:Georgia, Palatino, Palatino Linotype, Times, Times New Roman, serif;"> '+
	'* \'\'\'[[উইকিপিডিয়া:উইকিপত্রিকা|সম্পূর্ণ উইকিপত্রিকা পড়ুন]]\'\'\' * [[উইকিপিডিয়া:উইকিপত্রিকা/দেয়ালিকা' + data.today.iso + '|দেয়ালিকা]] * '+
	'[[উইকিপিডিয়া:উইকিপত্রিকা/গ্রাহক তালিকা|আনসাবস্ক্রাইব করুন]] * [[User:MediaWiki message delivery|MediaWiki message delivery]] ([[User talk:MediaWiki message delivery|talk]]) ~~~~~ ' +
	'<!-- Sent via script ([[' + data.script_page + ']]) --></div></div>';
	var msg_subject = "''উইকিপত্রিকা'': " + data.today.dmy;
	
	if (window.SPSdebug) {console.log("... sending MassMessage.");}
	return data.api.postWithEditToken({
		action: 'massmessage',
		spamlist: msg_spamlist,
		subject: msg_subject,
		message: msg_content
	});
};

// Step 10:
/**
 * gloablmassmsg
 *
 * Mass-message global subscribers
 *
 * @param {Object} data -- configuration and other data, including
 *   @param {Object} data.metaApi -- real (foreign) api for editing, or fake api for logging proposed edits
 *   @param {String} data.path
 *   @param {Object} data.today
 *     @param {String} data.today.iso
 *     @param {String} data.today.dmy
 *   @param {String} data.script_page
 *   @param {Array} data.articles
 *
 * @returns Promise of a success or failure message
 */
var globalmassmsg = function(data) {
	if (window.SPSdebug) {console.log("Attempting to compose global MassMessage.");}
	var msg_spamlist = "Global message delivery/Targets/Signpost";
	var msg_subject = "''উইকিপত্রিকা'': " + data.today.dmy;
	var msg_top = '<div lang="en" dir="ltr" class="mw-content-ltr" style="margin-top:10px; font-size:90%; padding-left:5px; font-family:Georgia, Palatino, Palatino Linotype, Times, Times New Roman, serif;">'+
	'[[File:WikipediaSignpostIcon.svg|40px|right]] \'\'সুপ্রিয়! উইকিপত্রিকার নতুন সংখ্যা প্রকাশিত হয়েছে। আপনি নিচের তালিকা থেকে পছন্দমত প্রবন্ধগুলি পড়তে পারেন।\'\'</div>\n'+
	'<div style="column-count:2;">\n';
	var msg_mid = data.articles.reduce(function(midtext, article) {
		return midtext + "* " + article.section + ": [[w:bn:" + data.path + "/" + data.today.iso + "/" + article.section + "|" + article.title + "]]\n\n";
	}, '');
	var msg_bottom = '</div>\n'+
	'<div style="margin-top:10px; font-size:90%; padding-left:5px; font-family:Georgia, Palatino, Palatino Linotype, Times, Times New Roman, serif;">'+
	'\'\'\'[[w:en:Wikipedia:Wikipedia Signpost|Read this Signpost in full]]\'\'\' · [[w:en:Wikipedia:Signpost/Single|Single-page]] · '+
	'[[m:Global message delivery/Targets/Signpost|Unsubscribe]] · [[m:Global message delivery|Global message delivery]] ~~~~~\n'+
	'<!-- Sent via script ([[w:en:' + data.script_page + ']]) --></div>';
	if (window.SPSdebug) {console.log("... sending global MassMessage.");}
	return data.metaApi.postWithEditToken({
		action: 'massmessage',
		assert: 'user',
		spamlist: msg_spamlist,
		subject: msg_subject,
		message: msg_top + msg_mid + msg_bottom
	});
};

// Step 11:
/**
 * updateYearArchive
 *
 * Update the current year's archive overview page
 *
 * @param {Object} data -- configuration and other data, including
 *   @param {Object} data.api -- real api for editing, or fake api for logging proposed edits
 *   @param {String} data.path
 *   @param {Object} data.today
 *     @param {String} data.today.iso
 *     @param {String} data.today.dmy
 *     @param {String} data.today.month
 *     @param {String|Number} data.today.year
 *   @param {String} data.script_ad
 *   @param {String} data.vol -- Volume number of current issue
 *   @param {String} data.iss -- Issue number of current issue
 *
 * @returns Promise of a success or failure message
 */
var updateYearArchive = function(data) {
	if ( !data.vol || !data.iss ) {
		var notFound = ( !data.vol ? 'Volume number ' : '') + ( !data.vol && !data.iss ? 'and ' : '' ) + ( !data.iss ? 'Issue number ' : '');
		return $.Deferred().reject(notFound + 'not found');
	}
	if (window.SPSdebug) {console.log("Attempting to update year archive.");}
	return data.api.get({
		action: 'query',
		titles: data.path + "/আর্কাইভ/" + data.today.year,
		prop: 'revisions',
		rvprop: 'content',
		indexpageids: 1
	})
	.then(function(result) {
		// Zero-padded issue number
		var padded_iss = ( data.iss.length === 1 ) ? "0" + data.iss : data.iss;
	
		var newContent = "===[[উইকিপিডিয়া:উইকিপত্রিকা/আর্কাইভ/" + data.today.iso +
			"|বর্ষ " + bn(data.vol) + ", সংখ্যা " + bn(padded_iss) + "]], " + data.today.iso + ' বঙ্গাব্দ' +  
			"===\n{{উইকিপিডিয়া:উইকিপত্রিকা/" + data.today.iso + "}}\n\n";

		var emptyPageStartText = "{{উইকিপিডিয়া:উইকিপত্রিকা/আর্কাইভ|year=" +
			data.today.year +	"}}\n\n<br />\n{{টেমপ্লেট:উইকিপত্রিকা মাসের সূচি|" + data.today.year + "}}\n\n" +
			"{{উইকিপিডিয়া:উইকিপত্রিকা/টেমপ্লেট:উইকিপত্রিকা পাদলেখ}}\n" +
			"[[বিষয়শ্রেণী:উইকিপত্রিকা আর্কাইভ|" +	data.year +
			"]]\n[[বিষয়শ্রেণী:উইকিপত্রিকা আর্কাইভ " +	data.today.year + "| ]]";
		var pid = result.query.pageids[0];
		var pageDoesNotExist = ( pid < 0 );
		var wikitext = ( pageDoesNotExist ) ? emptyPageStartText : result.query.pages[pid].revisions[ 0 ]['*'];
		const getBengaliSeason = m => ({"বৈশাখ":"গ্রীষ্ম", "জ্যৈষ্ঠ":"গ্রীষ্ম", "আষাঢ়":"বর্ষা", "শ্রাবণ":"বর্ষা", "ভাদ্র":"শরৎ", "আশ্বিন":"শরৎ", "কার্তিক":"হেমন্ত", "অগ্রহায়ণ":"হেমন্ত", "পৌষ":"শীত", "মাঘ":"শীত", "ফাল্গুন":"বসন্ত", "চৈত্র":"বসন্ত"}[m] || "অজানা");
		var needsMonthHeading = ( wikitext.indexOf(getBengaliSeason(data.today.month)) === -1 );
		var newContentHeading = ( needsMonthHeading ) ? "== " + getBengaliSeason(data.today.month) + " ==\n" : '';
	
		var insertionPoint = ""; // a falsey value
		if ( wikitext.indexOf("{{উইকিপিডিয়া:উইকিপত্রিকা/টেমপ্লেট:উইকিপত্রিকা পাদলেখ}}") !== -1 ) {
			insertionPoint = "{{উইকিপিডিয়া:উইকিপত্রিকা/টেমপ্লেট:উইকিপত্রিকা পাদলেখ}}";
		} else if ( wikitext.indexOf('[[বিষয়শ্রেণী:') !== -1 ) {
			// footer not found, insert new wikitext above categories
			insertionPoint = "[[বিষয়শ্রেণী:";
		}
		if ( !insertionPoint ) {
			return wikitext.trim() + newContentHeading + newContent.trim();
		} else {
			return wikitext.replace(insertionPoint, newContentHeading + newContent + insertionPoint);
		}
	})
	.then(function(wikitext) {
		if (window.SPSdebug) {console.log("... সম্পাদনা সংরক্ষণ করা হচ্ছে।");}
		return data.api.postWithEditToken({
			action: 'edit',
			title: data.path + "/আর্কাইভ/" + data.today.year,
			text: wikitext,
			summary: data.script_ad + "পরবর্তী সংখ্যা যোগ" 
		});
	});
};

// Step 12:
/**
 * createArchiveCats
 *
 * Create archive categories for current month and year, if they don't already exist
 *
 * @param {Object} data -- configuration and other data, including
 *   @param {Object} data.api -- real api for editing, or fake api for logging proposed edits
 *   @param {String} data.path
 *   @param {Object} data.today
 *     @param {String} data.today.iso
 *     @param {String|Number} data.today.year
 *   @param {String} data.script_ad
 *
 * @returns Promise of a success or failure message
 */
var createArchiveCats = function(data) {
	if (window.SPSdebug) {console.log("Attempting to create archive cats.");}
	// Ignore the articleexists error
	var promiseWithoutExistsError = function(promise) {
		return promise.then(
			function(v) { return v; },
			function(c, jqxhr) {
				return ( c === 'articleexists' ) ? c : $.Deferred().reject(c, jqxhr);
			}
		);
	};
	const getMonthNumberBn = m => ({"বৈশাখ":"০১","জ্যৈষ্ঠ":"০২","আষাঢ়":"০৩","শ্রাবণ":"০৪","ভাদ্র":"০৫","আশ্বিন":"০৬","কার্তিক":"০৭","অগ্রহায়ণ":"০৮","পৌষ":"০৯","মাঘ":"১০","ফাল্গুন":"১১","চৈত্র":"১২"})[m];
	var month_cat_title = "বিষয়শ্রেণী:উইকিপিডিয়া:উইকিপত্রিকা/আর্কাইভ " + data.today.iso;
	var month_cat_text = "[[বিষয়শ্রেণী:উইকিপিডিয়া:উইকিপত্রিকা/আর্কাইভ " + data.today.year +
	"|" + getMonthNumberBn(data.today.month) + "]]"; 

	var year_cat_title = "বিষয়শ্রেণী:উইকিপিডিয়া:উইকিপত্রিকা/আর্কাইভ " + data.today.year;
	var year_cat_text = "{{উইকিপিডিয়া:উইকিপত্রিকা/আর্কাইভ}}\n\n" +
	"[[বিষয়শ্রেণী:উইকিপিডিয়া:উইকিপত্রিকা/আর্কাইভ|" + data.today.year + "]]";

	var monthCatPrmoise = promiseWithoutExistsError(
		data.api.postWithEditToken({
			action: 'edit',
			title: month_cat_title,
			text: month_cat_text,
			summary: "Create" + data.script_ad,
			createonly: 1
		})
	);

	var yearCatPromise = promiseWithoutExistsError(
		data.api.postWithEditToken({
			action: 'edit',
			title: year_cat_title,
			text: year_cat_text,
			summary: "Create" + data.script_ad,
			createonly: 1
		})
	);

	if (window.SPSdebug) {console.log("... attempting to make cats meow");}
	return $.when(monthCatPrmoise, yearCatPromise);
};

// Step 13:
/**
 * updateOldNextLinks
 *
 * Update previous issue's "next" links
 *
 * @param {Object} data -- configuration and other data, including
 *   @param {Object} data.api -- real api for editing, or fake api for logging proposed edits
 *   @param {String} data.path
 *   @param {Object} data.today
 *     @param {String} data.today.iso
 *   @param {String} data.script_ad
 *   @param {Array} data.articles
 *   @param {Object} data.previousIssueDates
 *
 * @returns Promise of a success or failure message
 */
var updateOldNextLinks = function(data) {
	if (window.SPSdebug) {console.log("Attempting to update old 'next' links.");}
	if ( !data.previousIssueDates ) {
		return $.Deferred().reject('Previous issues not found');
	}
	var prevtitles = data.articles.map(function(article) {
		if ( !data.previousIssueDates[article.section] ) {
			return '';
		}
		return data.path + "/" + data.previousIssueDates[article.section] + "/" + article.section;
	})
	.filter(function(v) {
		return v !== '';
	});

	if ( prevtitles.length === 0 ) {
		return $.Deferred().reject('পূর্ববর্তী সংখ্যা পাওয়া যায়নি।');
	}

	if (window.SPSdebug) {console.log("... সম্পাদনা সংরক্ষণ করা হচ্ছে।");}
	return data.api.get({
		action: 'query',
		titles: prevtitles,
		prop: 'revisions',
		rvprop: 'content',
		indexpageids: 1
	})
	.then(function(result) {
		var pageEditPromises = $.map(result.query.pages, function(page) {
			var oldwikitext = page.revisions[ 0 ][ '*' ];
			var wikitext = oldwikitext.replace(
				/(\{\{উইকিপিডিয়া:উইকিপত্রিকা\/টেমপ্লেট\/উইকিপত্রিকা-প্রবন্ধ-মন্তব্য-শেষ\|\|[^\|]+\|)(\}\})/, 
				"$1" + data.today.iso + "}}"
			);
			return data.api.postWithEditToken({
				action: 'edit',
				title: page.title,
				text: wikitext,
				summary: data.script_ad + "Add next edition"
			});
		});
		return whenAll(pageEditPromises);
	});
};

// Step 14:
/**
 * requestWatchlistNotification
 *
 * Request a new watchlist notification
 *
 * @param {Object} data -- configuration and other data, including
 *   @param {Object} data.api -- real api for editing, or fake api for logging proposed edits
 *   @param {String} data.path
 *   @param {Object} data.today
 *     @param {String} data.today.iso
 *     @param {String} data.today.month
 *   @param {String} data.script_ad
 *
 * @returns Promise of a success or failure message
 */
var requestWatchlistNotification = function(data) {
	// return "Disabled, JPxG 2023-05-22"
	if (window.SPSdebug) {console.log("Attempting to create request watchlist notice.");}
	return data.api.postWithEditToken({
		action: 'edit',
		title: 'MediaWiki talk:Watchlist-messages',
		section: 'new',
		sectiontitle: 'উইকিপত্রিকা বিজ্ঞপ্তি: ' + data.today.iso,
		text: "{{সম্পাদনার অনুরোধ}}\n[[" + data.path + "/আর্কাইভ/" + data.today.iso + "|" + data.today.month + " সংখ্যা]] প্রকাশিত হয়েছে। ~~~~",
		summary: data.script_ad + "Requesting a notice for this month's Signpost edition"
	});
};
var createSingleTalk = function(data) {
	if (window.SPSdebug) {console.log("Attempting to create single-page talk.");}
	return data.api.postWithEditToken({
		action: 'edit', 
		title: 'উইকিপিডিয়া আলোচনা:উইকিপত্রিকা/দেয়ালিকা/' + data.today.iso,
		text: "{{উইকিপিডিয়া:উইকিপত্রিকা/টেমপ্লেট/দেয়ালিকা আলাপ}}",
		summary: data.script_ad + "[[উইকিপিডিয়া:উইকিপত্রিকা/টেমপ্লেট/দেয়ালিকা আলাপ]] সহ নতুন দেয়ালিকার আলাপ পাতা তৈরিকরণ" 
	});
};

/* ========== Main Dialog ======================================================================= */
/* ---------- DraggableGroupStack class---------------------------------------------------------- */
var DraggableGroupStack = function OoUiDraggableGroupStack( config ) {
	config = config || {};
	config.draggable = true;
	config.expanded = false;
	config.padded = true;
	config.framed = true;

	// Parent constructor
	DraggableGroupStack.parent.call( this, config );

	config.$group = this.$element;

	// Mixin constructor
	OO.ui.mixin.DraggableGroupElement.call( this, config );
};
OO.inheritClass( DraggableGroupStack, OO.ui.StackLayout );
OO.mixinClass( DraggableGroupStack, OO.ui.mixin.DraggableGroupElement );
DraggableGroupStack.prototype.removeItems = function() { return this; };
//DraggableGroupStack.prototype.addItems = OO.ui.StackLayout.prototype.addItems;

/* ---------- DraggablePanel class -------------------------------------------------------------- */
var DraggablePanel = function OoUiDraggablePanel( config ) {
	config = config || {};
	if ( config.classes && $.isArray(config.classes) ) {
		config.classes.push('SPS-dialog-DraggablePanel');
	} else {
		config.classes = ['SPS-dialog-DraggablePanel'];
	}

	// Parent constructor
	DraggablePanel.parent.call( this, config );

	// Mixin constructor
	OO.ui.mixin.DraggableElement.call( this, config );

	this.$element
		.on( 'click', this.select.bind( this ) )
		.on( 'keydown', this.onKeyDown.bind( this ) )
		// Prevent propagation of mousedown
		.on( 'mousedown', function( e ) { e.stopPropagation(); });

	// Initialization
	/*
	this.$element
		.append( this.$label, this.closeButton.$element );
	*/
};
OO.inheritClass( DraggablePanel, OO.ui.PanelLayout );
OO.mixinClass( DraggablePanel, OO.ui.mixin.DraggableElement );
/**
 * Handle a keydown event on the widget
 *
 * @fires navigate
 * @param {jQuery.Event} e Key down event
 * @return {boolean|undefined} false to stop the operation
 */
DraggablePanel.prototype.onKeyDown = function( e ) {
	var movement;

	if ( e.keyCode === OO.ui.Keys.ENTER ) {
		this.select();
		return false;
	} else if (
		e.keyCode === OO.ui.Keys.LEFT ||
		e.keyCode === OO.ui.Keys.RIGHT ||
		e.keyCode === OO.ui.Keys.UP ||
		e.keyCode === OO.ui.Keys.DOWN
	) {
		if ( OO.ui.Element.static.getDir( this.$element ) === 'rtl' ) {
			movement = {
				left: 'forwards',
				right: 'backwards'
			};
		} else {
			movement = {
				left: 'backwards',
				right: 'forwards'
			};
		}

		this.emit(
			'navigate',
			e.keyCode === OO.ui.Keys.LEFT ?
				movement.left : movement.right
		);
		return false;
	} else if (
		e.keyCode === OO.ui.Keys.UP ||
		e.keyCode === OO.ui.Keys.DOWN
	) {
		this.emit(
			'navigate',
			e.keyCode === OO.ui.Keys.UP ?
				'backwards' : 'forwards'
		);
		return false;
	}
};
/**
 * Select this item
 *
 * @fires select
 */
DraggablePanel.prototype.select = function() {
	this.emit( 'select' );
};

/* ---------- MainDialog class ------------------------------------------------------------------ */
var MainDialog = function OoUiMainDialog( config ) {
	MainDialog.super.call( this, config );
};
OO.inheritClass( MainDialog, OO.ui.ProcessDialog );
MainDialog.static.name = 'mainDialog';
/* ~~~~~~~~~~ Available actions (buttons) ~~~~~~~~~~ */
MainDialog.static.actions = [
	{ action: 'close', modes: ['welcome', 'choose', 'sort'], label: 'বাতিল', flags: 'safe' },
	{ action: 'start', modes: 'welcome', label: 'শুরু করুন', flags: ['primary', 'progressive'] },
	{ action: 'dryrun', modes: 'welcome', label: 'কেবল পরীক্ষা চালান', flags: 'progressive' },
	{ action: 'back-to-welcome', modes: 'choose', label: 'পিছনে', flags: 'safe' },
	{ action: 'next-to-sort', modes: 'choose', label: 'পরবর্তী', flags: ['primary', 'progressive'] },
	{ action: 'back-to-choose', modes: 'sort', label: 'পিছনে', flags: 'safe' },
	{ action: 'next-to-status', modes: 'sort', label:'প্রকাশ', flags: ['primary', 'progressive'] },
	{ action: 'next-to-finished', modes: 'status', label: 'চালিয়ে যান', flags: ['primary', 'progressive'], disabled: true },
	{ action: 'abort', modes: 'status', label: 'বাতিল', flags: ['safe', 'destructive']},
	{ action: 'close', modes: ['finished', 'aborted'], label: 'বন্ধ', flags: ['primary', 'progressive'] },
	{ action: 'back-to-status', modes: 'finished', label: 'পিছনে', flags: 'safe' }
];
// Get dialog height.
MainDialog.prototype.getBodyHeight = function() {
	var headHeight = this.$head.outerHeight(true);
	var footHeight = this.$foot.outerHeight(true);
	var currentPanelContentsHeight = $(this.stackLayout.currentItem.$element).children().outerHeight(true);
	return headHeight + footHeight + currentPanelContentsHeight;
};
/* ~~~~~~~~~~ Initiliase the content and layouts ~~~~~~~~~~ */
MainDialog.prototype.initialize = function() {
	MainDialog.super.prototype.initialize.apply(this, arguments);
	var dialog = this;
	this.panels = {
		welcome: new OO.ui.PanelLayout({
			$content: $('<div>').append([
				$('<p>').addClass('SPS-dialog-heading').text('উইকিপত্রিকা প্রকাশনা স্ক্রিপ্টে স্বাগত'),
				$('<p>').text('নিশ্চিত করুন যেন প্রতিটি নিবন্ধে যেন {{উইকিপত্রিকা খসড়া}} টেমপ্লেট যেন সম্পূর্ণ থাকে, এবং এটি যেন "উইকিপিডিয়া:উইকিপত্রিকা/পরবর্তী সংখ্যা/" এর একটি উপপাতা হয়।'),
				$('<p>').text('"পরীক্ষা চালান" মোড প্রকৃত পরিবর্তন না করেই প্রকাশনার প্রক্রিয়াসমূহ কেবল অনুকরণ করে এবং কার্যক্রমগুলো ব্রাউজারের জাভাস্ক্রিপ্ট কনসোলে লগ হয়; প্রাকদর্শন বিদ্যমান"')
			]),
			classes: [ 'one' ],
			padded: true,
			scrollable: true,
			expanded: true
		}),
		choose: new OO.ui.PanelLayout({
			$content: $('<div>').append([
				$('<p>').addClass('SPS-dialog-heading').append([
					'নিবন্ধ নির্বাচন করুন',
					$('<span>').addClass('SPS-dryRun').text('[কেবল পরীক্ষা চালান]')
				])
			]),
			classes: [ 'two' ],
			padded: true,
			scrollable: true,
			expanded: true
		}),
		sort: new OO.ui.PanelLayout({
			$content: $('<div>').append([
				$('<p>').addClass('SPS-dialog-heading').append([
					'ক্রম, শিরোনাম এবং সারসংক্ষেপ পরীক্ষা করুন',
					$('<span>').addClass('SPS-dryRun').text('[কেবল পরীক্ষা চালান]')
				])
			]),
			classes: [ 'three' ],
			padded: true,
			scrollable: true,
			expanded: true
		}),
		status: new OO.ui.PanelLayout({
			$content: $('<div>').append([
				$('<p>').addClass('SPS-dialog-heading').append([
					'অবস্থা',
					$('<span>').addClass('SPS-dryRun').text('[কেবল পরীক্ষা চালান]')
				])
			]),
			classes: [ 'four' ],
			padded: true,
			scrollable: true,
			expanded: true
		}),
		finished: new OO.ui.PanelLayout({
			$content: $('<div>').append([
				$('<p>').addClass('SPS-dialog-heading').append([
					'সম্পন্ন!',
					$('<span>').addClass('SPS-dryRun').text('[কেবল পরীক্ষা চালান]')
				]),
				$('<div>').attr('id', 'SPS-previewButton-container'),
				$('<p>').text('নতুন সংখ্যা সম্পর্কে মেইলিং লিস্ট, টুইটার, এবং ফেসবুকে ঘোষণা দিতে ভুলবেন না।')
			]),
			classes: [ 'five' ],
			padded: true,
			scrollable: true,
			expanded: true
		}),
		aborted: new OO.ui.PanelLayout({
			$content: $('<div>').append([
				$('<p>').addClass('SPS-dialog-heading').append([
					'বন্ধ করা হয়েছে',
					$('<span>').addClass('SPS-dryRun').text('[কেবল পরীক্ষা চালান]')
				]),
				$('<p>').append([
					'Follow the manual steps at ',
					extraJs.makeLink('Wikipedia:Wikipedia Signpost/Newsroom/Resources', 'the resources page'),
					' to complete publiction.'
				])
			]),
			classes: [ 'six' ],
			padded: true,
			scrollable: true,
			expanded: true
		})
	};
	this.stackLayout = new OO.ui.StackLayout({
		items: $.map(dialog.panels, function(panel) { return panel; })
	});
	this.$body.append(this.stackLayout.$element);
};
/* ~~~~~~~~~~ Set panels contents ~~~~~~~~~~ */
/** @param {Array} titles **/
MainDialog.prototype.setChoosePanelContent = function(titles) {
	var dialog = this;
	var cachedSelectedTitles = readFromCache('selected-titles');
	var titleCheckboxes = titles.map(function(title) {
		return new OO.ui.CheckboxMultioptionWidget({
		data: title,
		selected: ( cachedSelectedTitles ) ? cachedSelectedTitles.indexOf(title) !== -1 : true,
		label: $('<span>')
			.append([
				title,
				' ',
				extraJs.makeLink(title,'→')
			])
		});
	});
	this.widgets.titlesMultiselect = new OO.ui.CheckboxMultiselectWidget({
		items: titleCheckboxes,
		id: 'SPS-dialog-titlesMultiselect'
	});
	this.getPanelElement('choose')
	.find('#SPS-dialog-titlesMultiselect').remove().end()
	.append( dialog.widgets.titlesMultiselect.$element );
};
/** @param {Array} selectedTitles, @param {Boolean} startAtZeroValue **/
MainDialog.prototype.setSortPanelContent = function(articlesInfo, startAtZeroValue) {
	var makeItemContent = function(section, title, blurb) {
		return new OO.ui.ActionFieldLayout(
			new OO.ui.LabelWidget({
				label: $('<div>').append([
					$('<span>').addClass('SPS-dialog-item-section')
					.text(section+' ')
					.append(
						extraJs.makeLink('উইকিপিডিয়া:উইকিপত্রিকা/পরবর্তী_সংখ্যা/'+section, '→')
					),
					$('<div>').addClass('SPS-dialog-item-title').text(title),
					$('<div>').addClass('SPS-dialog-item-blurb').text(blurb)
				])
			}),
			new OO.ui.IconWidget({
				icon: 'draggable',
				title: 'Drag to reposition'
			})
		).$element;
	};
	var articleItems = articlesInfo.map(function(info) {
		return new DraggablePanel({
			expanded: false,
			framed: true,
			padded: false,
			data: info,
			$content: makeItemContent(info.section, info.title, info.blurb)
		});
	});
	this.widgets.sortOrderDraggabelGroup = new DraggableGroupStack({
		continuous: true,
		orientation: 'vertical',
		id: 'SPS-dialog-sortOrderDraggabelGroup',
		items: articleItems
	});
	$(this.widgets.sortOrderDraggabelGroup.$element).append(
		articleItems.map(function(item) { return item.$element; })
	);

	this.widgets.startAtZeroCheckbox = new OO.ui.CheckboxMultioptionWidget({
		selected: startAtZeroValue,
		label: 'Use announcement ("from the editors") formatting for first item',
		id: 'SPS-dialog-startAtZeroCheckbox'
	});

	this.getPanelElement('sort')
		.find('#SPS-dialog-sortOrderDraggabelGroup').remove().end()
		.find('#SPS-dialog-startAtZeroCheckbox').remove().end()
		.append([
			this.widgets.sortOrderDraggabelGroup.$element,
			this.widgets.startAtZeroCheckbox.$element,
		]);
};
MainDialog.prototype.setStatusPanelContent = function() {
	var moveDelayNotice = ( this.data.articles.length > maxMovesPerMinute ) ?
		 '&#32;(বি.দ্র.: প্রযুক্তিগত সীমাবদ্ধতার কারণে আনুমানিক ' + Math.floor(this.data.articles.length / maxMovesPerMinute) + ' মিনিট লাগতে পারে)&#32;' : '';
	var taskDescriptions = [
		'সংখ্যা পাতা তৈরি করা হচ্ছে',
		'নিবন্ধসমূহ প্রস্তুত করা হচ্ছে',
		$('<span>').text('নিবন্ধসমূহ স্থানান্তর করা হচ্ছে').append(
			$('<span>').css('font-size', '88%').append(moveDelayNotice)
		),
	  'সংখ্যা পাতা সম্পাদনা করা হচ্ছে',
	  'উইকিপত্রিকার প্রধান পাতা সম্পাদনা করা হচ্ছে',
	  'দেয়ালিকা পাতা সংস্করণ তৈরি করা হচ্ছে',
	  'আর্কাইভ পাতা তৈরি করা হচ্ছে',
	  'আগের সংস্করণের আর্কাইভ পাতা হালনাগাদ করা হচ্ছে',
	  'পাতাগুলো শোধন করা হচ্ছে',
	  'বাংলা উইকির গ্রাহকদের গণবার্তা প্রেরণ করা হচ্ছে',
	  'বৈশ্বিক গ্রাহকদের গণবার্তা প্রেরণ করা হচ্ছে',
	  'বর্তমান বছরের আর্কাইভের সংক্ষিপ্ত বিবরণী পাতা হালনাগাদ করা হচ্ছে',
	  'আর্কাইভ বিষয়শ্রেণী তৈরি করা হচ্ছে (প্রয়োজন হলে)',
	  'আগের সংখ্যার "পরবর্তী" সংযোগ হালনাগাদ করা হচ্ছে',
	  'নতুন নজরতালিকা অবহিতকারী তৈরি করা হচ্ছে',
	  'একটি দেয়ালিকা পাতা তৈরি করা হচ্ছে'
	];
	this.taskItems = taskDescriptions.map(function(description, index) {
		return new OO.ui.Widget({
			$element: $('<li>'),
			id: 'SPS-task-'+index,
			classes: ['SPS-task'],
			$content: $('<span>').append([
				description,
				'... ',
				$('<span>').addClass('SPS-task-status').text('অপেক্ষমান')
			]),
			data: {completed: false}
		});
	});
	this.getPanelElement('status')
		.find('#SPS-dialog-taskList').remove().end()
		.append(
			$('<ul>').attr('id', 'SPS-dialog-taskList')
			.append(
				this.taskItems.map(function(item) { return item.$element; })
			)
		);
};
MainDialog.prototype.resetFinishedPanel = function() {
	$('#SPS-previewButton-container').empty();
};

/* ~~~~~~~~~~ Process panels (read their state, and set data based on it) ~~~~~~~~~~ */
MainDialog.prototype.processWelcomePanel = function(action) {
	if ( action === 'start' ) {
		this.data.api = new mw.Api(apiConfig);
		this.data.metaApi = new mw.ForeignApi('https://meta.wikimedia.org/w/api.php', apiConfig);
		$('.SPS-dryRun').hide();
	} else {
		this.data.api = new FakeApi(apiConfig);
		this.data.metaApi = new FakeApi(apiConfig);
		$('.SPS-dryRun').show();
	}
};
MainDialog.prototype.processChoosePanel = function() {
	if ( !this.data || !this.data.api ) {
		return;
	}
	var oldCachedTitles = readFromCache('selected-titles');
	this.data.selectedTitles = this.getSelectedTitles();
	writeToCache('selected-titles', this.data.selectedTitles);
	return oldCachedTitles;
};
MainDialog.prototype.processSortPanel = function() {
	if ( !this.data || !this.data.api ) {
		return true;
	}
	this.data.articles = this.getArticleInfosInOrder();
	writeToCache('info', this.data.articles);
	var startAtZero = this.getStartAtZeroBoolean();
	this.data.firstItemIndex = ( startAtZero ) ? 0 : 1;
	writeToCache('startAtZero', startAtZero);
};


/* ~~~~~~~~~~ Process actions ~~~~~~~~~~ */
// Get the process (steps to be done) for each action (button click).
// Generally, set the new mode, get the new panel ready, and display the new panel.
MainDialog.prototype.getActionProcess = function( action ) {
	var dialog = this;

	if ( action === 'start' || action === 'dryrun' ) {
		return new OO.ui.Process(function() {
			dialog.processWelcomePanel(action);
		})
		.next(function() {
			return dialog.getTitlesFromCacheOrApi()
			.then(dialog.cacheTitlesIfNotCached)
			.then(function(titles) { dialog.setChoosePanelContent.call(dialog, titles); });
		})
		.next(function() {
			dialog.actions.setMode('choose');
			dialog.stackLayout.setItem(dialog.panels.choose);
		});
	} else if ( action === 'next-to-sort' ) {
		return new OO.ui.Process(function() {
			return $.when(dialog.processChoosePanel())
			.then(function(oldCachedSelectedTitles) {
				return dialog.getArticleAndIssueInfo.call(dialog, oldCachedSelectedTitles);
			})
			.then(function(articleInfos, prevIssueDates, startAtZero) {
				dialog.setPrevIssueDates(prevIssueDates);
				return dialog.setSortPanelContent(articleInfos, startAtZero);
			});
		})
		.next(function() {
			dialog.actions.setMode('sort');
			dialog.stackLayout.setItem(dialog.panels.sort);
			var publishButtonLabel = ( dialog.data.api.isFake ) ? 'Simulate publishing' : 'Publish';
			dialog.getActions().getSpecial().primary.setLabel(publishButtonLabel);
		}) // Hack to calculate size from this panel, rather than the previous panel
		.next(function() {
			dialog.actions.setMode('sort');
			dialog.stackLayout.setItem(dialog.panels.sort);
			var publishButtonLabel = ( dialog.data.api.isFake ) ? 'Simulate publishing' : 'Publish';
			dialog.getActions().getSpecial().primary.setLabel(publishButtonLabel);
		});
	} else if ( action === 'next-to-status' ) {
		return new OO.ui.Process(function() {
			dialog.processSortPanel.call(dialog);
		})
		.next(dialog.setStatusPanelContent, this)
		.next(function() {
			dialog.actions.setMode('status');
			dialog.stackLayout.setItem(dialog.panels.status);
		})
		.next(dialog.resetFinishedPanel)
		.next(function() {
			dialog.doPublishing.call(dialog);
		});
	} else if ( action === 'next-to-finished' ) {
		return new OO.ui.Process(function() {
			dialog.actions.setMode('finished');
			dialog.stackLayout.setItem(dialog.panels.finished);
		});
	} else if ( action === 'abort' ) {
		return new OO.ui.Process(function() {
			dialog.data.api.abort();
			dialog.actions.setMode('aborted');
			dialog.stackLayout.setItem(dialog.panels.aborted);
		});
	} else if ( action === 'back-to-welcome' || action === 'welcome' ) {
		return new OO.ui.Process(dialog.processChoosePanel)
		.next(function() {
			dialog.actions.setMode('welcome');
			dialog.stackLayout.setItem(dialog.panels.welcome);
		});
	} else if ( action === 'back-to-choose' ) {
		return new OO.ui.Process(dialog.processSortPanel)
		.next(function() {
			dialog.actions.setMode('choose');
			dialog.stackLayout.setItem(dialog.panels.choose);
			dialog.updateSize();
		});
	} else if ( action === 'back-to-status' ) {
		return new OO.ui.Process(function() {
			dialog.actions.setMode('status');
			dialog.stackLayout.setItem(dialog.panels.status);
		}) // Hack to calculate size from this panel, rather than the previous panel
		.next(function() {
			dialog.actions.setMode('status');
			dialog.stackLayout.setItem(dialog.panels.status);
		});
	} else if ( action === 'close' ) {
		return new OO.ui.Process(dialog.processChoosePanel)
		.next(dialog.processSortPanel)
		.next(function() { dialog.close(); });
	}
	return MainDialog.super.prototype.getActionProcess.call( this, action );
};
// Set up the initial mode
MainDialog.prototype.getSetupProcess = function( data ) {
	var dialog = this;
	data = data || {};
	dialog.data = data;
	return MainDialog.super.prototype.getSetupProcess.call( this, data )
	.next( function() {
		dialog.widgets = {};
		dialog.actions.setMode( 'welcome' );
		dialog.stackLayout.setItem(dialog.panels.welcome);
		dialog.updateSize();
	}, this );
};
// Do the publishing
MainDialog.prototype.doPublishing = function() {
	var dialog = this;
	var taskComleted = function(taskNumber) {
		return dialog.taskItems[taskNumber].getData().completed;
	};
	var tasksFunctions = [
		makeIssuePage,
		prepareArticles,
		moveArticles,
		editIssueSubpage,
		editMain,
		makeSingle,
		makeArchive,
		updatePrevArchive,
		purgePages,
		massmsg,
		globalmassmsg,
		updateYearArchive,
		createArchiveCats,
		updateOldNextLinks,
		requestWatchlistNotification,
		createSingleTalk
	];
	var allDonePromise = tasksFunctions.reduce(
		function(previousPromise, tasksFunction, taskNumber) {
			return previousPromise
			.then(function() {
				dialog.showTaskStarted(taskNumber);
				if ( taskComleted(taskNumber) ) {
					return reflect('skipped');
				}
				return reflect( tasksFunction(dialog.getData()) );
			})
			.then(function(reflectdPromise) {
				return dialog.setTaskStatus(reflectdPromise, taskNumber);
			});
		},
		$.Deferred().resolve()
	);
	return allDonePromise.then(function() {
		var dialogSpecialActions = dialog.getActions().getSpecial();
		dialogSpecialActions.primary.setDisabled(false);
		dialogSpecialActions.safe.setDisabled(true);
	});
};

/* ~~~~~~~~~~ Helper functions: getters ~~~~~~~~~~ */
/**
 * @param {Array} oldCachedSelectedTitles
 * @returns Promise of:
 *    {Array} of objects containing article info for each selected title
 *    {String} the previous issue date
 *    {Boolean} value for 'startAtZero' checkbox
 */
MainDialog.prototype.getArticleAndIssueInfo = function(oldCachedSelectedTitles) {
	var dialog = this;
	var defaultStartAtZero = false;
	if ( oldCachedSelectedTitles ) {
		var sameTitles = ( this.data.selectedTitles.join('') === oldCachedSelectedTitles.join('') );
		var cachedPreviousIssueDates = readFromCache('previousIssueDates');
		var cachedInfo = readFromCache('info');
		var cachedStartAtZero = readFromCache('startAtZero') || false;

		if ( sameTitles && cachedPreviousIssueDates && cachedInfo ) {
			//dialog.data.prevIssueDates = cachedPreviousIssueDates;
			// Get the latest info, but in the previously set order
			return getInfo(this.data.api, oldCachedSelectedTitles, cachedPreviousIssueDates)
			.then(function(newInfo) {
				var sortingNewInfoNotPossible = newInfo.length !== cachedInfo.length;
				if ( sortingNewInfoNotPossible ) {
					// Just use the new info in the default order
					return $.Deferred().resolve(newInfo, cachedPreviousIssueDates, defaultStartAtZero);
				}
			
				// Sort the new info into the same order as the old info
				var sortedNewInfo = cachedInfo.map(function(oldArticle) {
					return newInfo.find(function(newArticle) {
						return newArticle.section === oldArticle.section;
					});
				});
			
				var hasEmptySlots = sortedNewInfo.some(function(e) { return e==null; });
				if ( hasEmptySlots ) {
					// Just use the new info in the default order
					return $.Deferred().resolve(newInfo, cachedPreviousIssueDates, defaultStartAtZero);
				}
			
				return $.Deferred().resolve(sortedNewInfo, cachedPreviousIssueDates, cachedStartAtZero);
			});
		}
	}
	return getPreviousIssueDates(this.data.api, this.data.today.year)
	.then(function(previousIssueDates) {
		return getInfo(dialog.data.api, dialog.data.selectedTitles, previousIssueDates)
		.then(function(articlesInfos) {
			return $.Deferred().resolve(articlesInfos, previousIssueDates, defaultStartAtZero);
		});
	});
};
MainDialog.prototype.getArticleInfosInOrder = function() {
	var items = this.widgets.sortOrderDraggabelGroup.getItems();
	return items.map(function(item) {
		return item.data;
	});
};
MainDialog.prototype.getPanelElement = function(panel) {
	return $('#' + this.panels[panel].getElementId()).children().first();
};
/**
 * @returns {Array} Selected titles
 */
MainDialog.prototype.getSelectedTitles = function() {
	return this.widgets.titlesMultiselect.findSelectedItemsData();
};
MainDialog.prototype.getStartAtZeroBoolean = function() {
	var checkbox = this.widgets.startAtZeroCheckbox;
	return checkbox.isSelected();
};
/** @returns Promise of an array of titles **/
MainDialog.prototype.getTitlesFromCacheOrApi = function() {
	var cachedTitles = readFromCache('titles');
	if ( cachedTitles ) {
		return $.Deferred().resolve(cachedTitles, true /* = alreadyCached */);
	}
	return getArticleTitles(this.data.api);
};

/* ~~~~~~~~~~ Helper functions: setters ~~~~~~~~~~ */
/**
 * @param {Array} titles
 * @param {Boolean} alreadyCached
 * @returns {Array} titles (passed through without modification)
 */
MainDialog.prototype.cacheTitlesIfNotCached = function(titles, alreadyCached) {
	if ( !alreadyCached ) {
		writeToCache('titles', titles);
	}
	return titles;
};
/**
 * @chainable
 * @param {Object} previousIssueDates - name:date pairs of section names and their previous issue date
 * @returns {Object} previousIssueDates
 */
MainDialog.prototype.setPrevIssueDates = function(previousIssueDates) {
	this.data.previousIssueDates = previousIssueDates;
	writeToCache('previousIssueDates', previousIssueDates);
	return previousIssueDates;
};

/* ~~~~~~~~~~ Task-related functions (status panel) ~~~~~~~~~~ */
MainDialog.prototype.showTaskStarted = function(i) {
	var task = this.taskItems[i];
	if ( task.getData().completed ) {
		return;
	}
	task.$element
		.addClass('SPS-task-doing')
		.find('.SPS-task-status')
		.text('...করা হচ্ছে...');
};
MainDialog.prototype.showTaskDone = function(i, skipped) {
	var task = this.taskItems[i];
	var taskClass = ( skipped ) ? 'SPS-task-skipped' : 'SPS-task-done';
	var statusText = ( skipped ) ? 'Skipped.' : 'সম্পন্ন!';
	task.$element
		.removeClass('SPS-task-doing')
		.addClass(taskClass)
		.find('.SPS-task-status')
		.text(statusText);
};
MainDialog.prototype.showTaskFailed = function(i, reason, allowRetry, handledPromise) {
	var dialog = this;
	var task = dialog.taskItems[i];
	var taskData = task.getData();

	var retryButton = $('<button>')
		.addClass('SPS-inlineButton mw-ui-button mw-ui-progressive')
		.text('Retry')
		.click(function() {
			task.$element
				.removeClass('SPS-task-failed')
				.find('.SPS-task-errorMsg, #SPS-errorbox-'+i)
				.remove();
			taskData.completed = false;
			taskData.skipped = false;
			task.setData(taskData);
			dialog.doPublishing()
				.always(function() {
					dialog.getActionProcess('next-to-finish');
				});
		});

	var skipButton = $('<button>')
		.addClass('SPS-inlineButton mw-ui-button')
		.append([
			'Continue ',
			$('<span>').addClass('no-bold').text('(after doing step manually)')
		])
		.click(function() {
			$('#SPS-errorbox-'+i).remove();
			taskData.completed = true;
			taskData.skipped = true;
			task.setData(taskData);
			dialog.showTaskDone(i, true);
			handledPromise.resolve();
		});

	var errorActions = $('<div>')
		.attr('id', 'SPS-errorbox-'+i)
		.append([
			( allowRetry ? retryButton : ''),
			skipButton
		]);

	task.$element
		.removeClass('SPS-task-doing')
		.addClass('SPS-task-failed')
		.find('.SPS-task-status')
		.empty()
		.after(errorActions)
		.after(
			$('<span>').addClass('SPS-task-errorMsg').text(' Failed (' + reason + ')')
		);
};
MainDialog.prototype.setTaskStatus = function(result, taskNumber) {
	var handledPromise = $.Deferred();
	var task = this.taskItems[taskNumber];
	var taskData = task.getData();

	if ( result.status === "resolved" ) {
		taskData.completed = true;
		task.setData(taskData);
		this.showTaskDone(taskNumber, taskData.skipped);
		if ( !taskData.skipped && taskNumber === 3 ) {
			var editionInfo = result.value[1];
			if ( editionInfo ) {
				this.data.previousIssueDate = editionInfo.previousIssueDate;
				this.data.vol = editionInfo.vol;
				this.data.iss = editionInfo.iss;
			}
		}
		handledPromise.resolve();
	} else {
		var tasksWithoutRetryOption = [1, 2, 6];
		var allowRetry = ( tasksWithoutRetryOption.indexOf(taskNumber) === -1 );
		this.showTaskFailed(
			taskNumber,
			extraJs.makeErrorMsg(result.error[0], result.error[1]),
			allowRetry,
			handledPromise
		);
	}
	return handledPromise;
};
/* ~~~~~~~~~ Window management ~~~~~~~~~~ */
var mainWindowFactory = new OO.Factory();
mainWindowFactory.register( MainDialog );
var mainWindowManager = new OO.ui.WindowManager({ factory: mainWindowFactory });
mainWindowManager.$element.addClass('sps-oouiWindowManager').insertBefore($('#SPS-ovarlayWindowManager'));

/* ========== Portlet link ====================================================================== */
// Add link to 'More' menu which starts everything
var portlet = mw.config.get('skin') === 'minerva' ? 'p-tb' : 'p-cactions';
mw.util.addPortletLink(portlet, '#', 'Publish next edition', 'ca-pubnext');
$('#ca-pubnext').on('click', function(e) {
	e.preventDefault();
	// Configuration values
	var newDate = new Date();
	var config = {
		script_page:	'User:R1F4T/উইকিপ্রকাশক',
		script_ad:		" ([[User:R1F4T/উইকিপ্রকাশক|স্ক্রিপ্টের মাধ্যমে]]) ",
		path:			"উইকিপিডিয়া:উইকিপত্রিকা",
		today: {
			date:	newDate,
            iso :	bnDate().month + ' ' + bnDate().year,
			month:	bnDate().month,
			year:	bnDate().year
		},
		size: 'larger'
	};


	// Idiotic hack to make this issue be a specific day:
	// un comment this if an issue needs to be for a particular day
	// and it isn't that day (i.e. New Years', Leif Erikson Day, etc).
	// JPxG, 2024 January 11
	// var config = {
	// 	script_page:	'User:R1F4T/উইকিপ্রকাশক',
	// 	script_ad:		" ([[User:R1F4T/উইকিপ্রকাশক|স্ক্রিপ্টের মাধ্যমে]])",
	// 	path:			"উইকিপিডিয়া:উইকিপত্রিকা",
	// 	today: {
	// 		date:	newDate,
	// 		iso:	"ভাদ্র ১৪৩২",
	// 		month:	"ভাদ্র",
	// 		year:	"১৪৩২"
	// 	},
	// 	size: 'larger'
	// };
	// iso   = "2024-01-10"
	// day   = "10"
	// month = "January"
	// year  = "2024"
	config.today.dmy =  config.today.iso;
	// Open the main dialog window
	mainWindowManager.openWindow('mainDialog', config);
});

// End of full file closure wrappers
});
// </nowiki>
