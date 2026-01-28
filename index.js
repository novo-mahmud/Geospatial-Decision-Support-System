/**
 * Geospatial Decision Support System v21.1 (Median Update)
 * CHANGED: Calculations and Stats now use MEDIAN instead of MEAN.
 */

// ======================================================
// 1. GLOBAL CONFIG & DATA
// ======================================================
var START_YEAR = 2015;
var END_YEAR = 2025;
var geometry = null;
var savedROIs = {};
var viewMode = 'Standard';
var debounce;

var INDEX_DB = {
  'NDVI': {min: 0, max: 1, palette: [
    'ffffff', 'ce7e45', 'df923d', 'f1b555', 'fcd163', '99b718', '74a901',
    '66a000', '529400', '3e8601', '207401', '056201', '004c00', '023b01',
    '012e01', '011d01', '011301']},
  'EVI':  {min: 0, max: 1, palette: [
    'ffffff', 'ce7e45', 'df923d', 'f1b555', 'fcd163', '99b718', '74a901',
    '66a000', '529400', '3e8601', '207401', '056201', '004c00', '023b01',
    '012e01', '011d01', '011301']},
  'NDWI': {min: -0.5, max: 0.5, palette: ['0000ff', '00ffff', 'ffff00', 'ff0000', 'ffffff']},
  'MNDWI':{min: -0.5, max: 0.5, palette: ['0000ff', '00ffff', 'ffff00', 'ff0000', 'ffffff']},
  'NDBI': {min: -0.5, max: 0.5, palette: ['#00441b', '#f7f7f7', '#762a83']},
  'LST':  {min: 15, max: 45, palette: ['#313695', '#4575b4', '#abd9e9', '#ffffbf', '#fdae61', '#f46d43', '#a50026']}
};

// ======================================================
// 2. CORE UI SETUP
// ======================================================
var mainMap = ui.Map();
var leftMap = ui.Map();
var rightMap = ui.Map();
var linker = ui.Map.Linker([leftMap, rightMap]);
var splitPanel = ui.SplitPanel({firstPanel: leftMap, secondPanel: rightMap, orientation: 'horizontal', wipe: true});

// --- Zoom to ROI Button Functionality ---
var zoomBtn = ui.Button({
  label: '🔍 Zoom to your ROI',
  onClick: function() {
    if (geometry) {
      if (viewMode === 'Side-by-Side') {
        leftMap.centerObject(geometry);
        rightMap.centerObject(geometry);
      } else {
        mainMap.centerObject(geometry);
      }
    } else {
      alert('Please draw or load an ROI first!');
    }
  },
  style: {position: 'top-center', padding: '4px'}
});

// Add button to maps
mainMap.add(zoomBtn);
leftMap.add(ui.Button({label: '🔍 Zoom ROI', onClick: function(){leftMap.centerObject(geometry)}, style:{position:'top-left'}}));
rightMap.add(ui.Button({label: '🔍 Zoom ROI', onClick: function(){rightMap.centerObject(geometry)}, style:{position:'top-right'}}));

var leftPanel = ui.Panel({style: {width: '430px', padding: '10px'}});
var mapContainer = ui.Panel({style: {stretch: 'both'}}).add(mainMap);

// ======================================================
// 3. ENGINE & MASKING
// ======================================================
function applyQualityMasks(img) {
  var qa = img.select('QA_PIXEL');
  var cloudShadowBitMask = (1 << 1) | (1 << 3) | (1 << 4) | (1 << 5);
  var waterBitMask = (1 << 7);
  var cloudFree = qa.bitwiseAnd(cloudShadowBitMask).eq(0);
  var waterFree = qa.bitwiseAnd(waterBitMask).eq(0);
  var finalMask = ee.Image(1);
  if (cloudSlider.getValue() > 0) finalMask = finalMask.and(cloudFree);
  if (waterSlider.getValue() > 0) finalMask = finalMask.and(waterFree);
  return img.updateMask(finalMask);
}

function getAnnualImage(year, indexKey, roi) {
  if (!roi) return ee.Image(0).rename('index');
  var col = ee.ImageCollection("LANDSAT/LC08/C02/T1_L2")
    .filterBounds(roi)
    .filter(ee.Filter.calendarRange(year, year, 'year'))
    .map(applyQualityMasks);

  var processed = col.map(function(img) {
    var index;
    if (indexKey === 'NDVI') index = img.normalizedDifference(['SR_B5', 'SR_B4']);
    else if (indexKey === 'EVI') {
      index = img.expression('2.5 * ((NIR - RED) / (NIR + 6 * RED - 7.5 * BLUE + 1))', {
        'NIR': img.select('SR_B5').multiply(0.0000275).add(-0.2),
        'RED': img.select('SR_B4').multiply(0.0000275).add(-0.2),
        'BLUE': img.select('SR_B2').multiply(0.0000275).add(-0.2)
      });
    }
    else if (indexKey === 'NDWI') index = img.normalizedDifference(['SR_B3', 'SR_B5']);
    else if (indexKey === 'MNDWI') index = img.normalizedDifference(['SR_B3', 'SR_B6']);
    else if (indexKey === 'NDBI') index = img.normalizedDifference(['SR_B6', 'SR_B5']);
    else if (indexKey === 'LST') index = img.select('ST_B10').multiply(0.00341802).add(149.0).subtract(273.15);
    return index.rename('index').set('system:time_start', img.get('system:time_start'));
  });

  // CHANGED: Used median() instead of mean()
  return processed.median().clip(roi)
    .set('year', year)
    .set('system:time_start', ee.Date.fromYMD(year, 6, 1).millis());
}

// ======================================================
// 4. UI SECTIONS
// ======================================================
var projPanel = ui.Panel({style: {border: '1px solid #d5dbdb', padding: '8px'}});
var roiNameInput = ui.Textbox('ROI Name', 'Site_A');
var areaLabel = ui.Label('Area: 0.00 Ha', {fontSize: '12px', color: '#d35400'});
var drawBtn = ui.Button('Draw New', function() { mainMap.drawingTools().setShape('polygon'); mainMap.drawingTools().draw(); });
var clearRoiBtn = ui.Button('Clear ROI', function() { mainMap.drawingTools().layers().forEach(function(l){ l.geometries().reset(); }); geometry = null; });
var saveBtn = ui.Button('Save ROI', function() { if(!geometry) return; savedROIs[roiNameInput.getValue()] = geometry; roiSelect.items().reset(Object.keys(savedROIs)); });
var roiSelect = ui.Select({items: [], placeholder: 'Load ROI', onChange: function(k){ geometry = savedROIs[k]; mainMap.centerObject(geometry); refreshApp(); }});
projPanel.add(ui.Label('1. Project Manager', {fontWeight: 'bold'})).add(ui.Panel([drawBtn, clearRoiBtn, saveBtn], ui.Panel.Layout.flow('horizontal'))).add(roiNameInput).add(roiSelect).add(areaLabel);

var maskPanel = ui.Panel({style: {border: '1px solid #d5dbdb', margin: '10px 0px', padding: '8px'}});
var cloudSlider = ui.Slider({min: 0, max: 100, value: 100, step: 10, style: {stretch: 'horizontal'}, onChange: refreshApp});
var waterSlider = ui.Slider({min: 0, max: 100, value: 0, step: 10, style: {stretch: 'horizontal'}, onChange: refreshApp});
maskPanel.add(ui.Label('2. Quality Masking (%)', {fontWeight: 'bold'})).add(ui.Label('Cloud Mask:')).add(cloudSlider).add(ui.Label('Water Mask:')).add(waterSlider);

var studioPanel = ui.Panel({style: {border: '1px solid #d5dbdb', padding: '8px'}});
var indexSelect = ui.Select({items: Object.keys(INDEX_DB), value: 'NDVI', onChange: refreshApp});
var yearSelect = ui.Select({items: ee.List.sequence(START_YEAR, END_YEAR).getInfo().map(String), value: '2023', onChange: refreshApp});
var modeSelect = ui.Select({items: ['Standard', 'Side-by-Side', 'Anomaly'], value: 'Standard', onChange: function(m) { viewMode = m; refreshApp(); }});

var sbsControls = ui.Panel({style: {shown: false, backgroundColor: '#f4f6f6', padding: '5px'}});
var yearL = ui.Select({items: ee.List.sequence(START_YEAR, END_YEAR).getInfo().map(String), value: '2015', onChange: refreshApp});
var yearR = ui.Select({items: ee.List.sequence(START_YEAR, END_YEAR).getInfo().map(String), value: '2025', onChange: refreshApp});
sbsControls.add(ui.Panel([ui.Label('L:'), yearL, ui.Label('R:'), yearR], ui.Panel.Layout.flow('horizontal')));

var anomalyControls = ui.Panel({style: {shown: false, backgroundColor: '#f4f6f6', padding: '5px'}});
var compareYearSelect = ui.Select({items: ee.List.sequence(START_YEAR, END_YEAR).getInfo().map(String), value: '2015', onChange: refreshApp});
var threshSlider = ui.Slider({min: 0.1, max: 0.5, value: 0.2, step: 0.05, onChange: refreshApp});
anomalyControls.add(ui.Label('Base Year:')).add(compareYearSelect).add(ui.Label('Threshold:')).add(threshSlider);

studioPanel.add(ui.Label('3. Analysis Studio', {fontWeight: 'bold'})).add(ui.Panel([indexSelect, yearSelect], ui.Panel.Layout.flow('horizontal'))).add(ui.Label('View Mode:')).add(modeSelect).add(sbsControls).add(anomalyControls);

var chartPanel = ui.Panel({style: {border: '1px solid #d5dbdb', margin: '10px 0px'}});
var chartWidget = ui.Panel();
var downloadCSVBtn = ui.Button('Download Chart Data (CSV)', exportTable);
chartPanel.add(ui.Label('4. Visual Analytics (Trend)', {fontWeight: 'bold'})).add(chartWidget).add(downloadCSVBtn);

var statsTable = ui.Panel({style: {backgroundColor: '#f9f9f9', padding: '5px'}});
var exportPanel = ui.Panel({style: {border: '1px solid #34495e', padding: '5px'}});
exportPanel.add(ui.Label('5. Export Extraction', {fontWeight: 'bold'})).add(ui.Panel([ui.Button('Export Map', exportRaster), ui.Button('Export All Years', exportBatchRaster)], ui.Panel.Layout.flow('horizontal')));

leftPanel.add(ui.Label('GDSS v21.1 (Median)', {fontSize: '20px', fontWeight: 'bold'})).add(projPanel).add(maskPanel).add(studioPanel).add(chartPanel).add(statsTable).add(exportPanel);

// ======================================================
// 5. FUNCTIONAL LOGIC
// ======================================================
function refreshApp() {
  if (!geometry) return;
  var idx = indexSelect.getValue();
  var yr = parseInt(yearSelect.getValue());
  var vis = INDEX_DB[idx];
  
  mapContainer.clear();
  sbsControls.style().set('shown', viewMode === 'Side-by-Side');
  anomalyControls.style().set('shown', viewMode === 'Anomaly');

  if (viewMode === 'Standard') {
    mapContainer.add(mainMap);
    var img = getAnnualImage(yr, idx, geometry);
    mainMap.layers().set(0, ui.Map.Layer(img, vis, yr.toString()));
    updateStats(img);
  } 
  else if (viewMode === 'Side-by-Side') {
    mapContainer.add(splitPanel);
    var imgL = getAnnualImage(parseInt(yearL.getValue()), idx, geometry);
    var imgR = getAnnualImage(parseInt(yearR.getValue()), idx, geometry);
    leftMap.layers().set(0, ui.Map.Layer(imgL, vis, yearL.getValue()));
    rightMap.layers().set(0, ui.Map.Layer(imgR, vis, yearR.getValue()));
    leftMap.centerObject(geometry);
    rightMap.centerObject(geometry);
  }
  else if (viewMode === 'Anomaly') {
    mapContainer.add(mainMap);
    var currentImg = getAnnualImage(yr, idx, geometry);
    var baseImg = getAnnualImage(parseInt(compareYearSelect.getValue()), idx, geometry);
    var diff = currentImg.subtract(baseImg).abs().gt(threshSlider.getValue());
    mainMap.layers().set(0, ui.Map.Layer(currentImg.visualize({min:0, max:1, palette:['#bdc3c7','#2c3e50']}), {}, 'Base'));
    mainMap.layers().set(1, ui.Map.Layer(diff.selfMask(), {palette:['red']}, 'Anomalies'));
  }
  updateChart(idx);
}

function updateStats(img) {
  // CHANGED: Used ee.Reducer.median() and keys updated to index_median
  img.reduceRegion({
    reducer: ee.Reducer.median().combine(ee.Reducer.min(),'',true).combine(ee.Reducer.max(),'',true).combine(ee.Reducer.stdDev(),'',true).combine(ee.Reducer.count(),'',true), 
    geometry: geometry, scale: 30, maxPixels: 1e9
  }).evaluate(function(s) {
    statsTable.clear();
    if (!s || s.index_count === 0) {
      var reason = "Cloud"; 
      if (waterSlider.getValue() > 50 && cloudSlider.getValue() < 50) reason = "Water";
      else if (waterSlider.getValue() > 50 && cloudSlider.getValue() > 50) reason = "Water/Cloud";
      statsTable.add(ui.Label("No pixels found for your '" + reason + "' masking value.", {color: 'red'}));
      return;
    }
    statsTable.add(ui.Label('Stats (' + yearSelect.getValue() + ')', {fontWeight:'bold'}));
    // CHANGED: Updated label to 'Median' and key to index_median
    statsTable.add(ui.Panel([ui.Label('Median: ' + s.index_median.toFixed(3)), ui.Label('Min: ' + s.index_min.toFixed(3))], ui.Panel.Layout.flow('horizontal')));
    statsTable.add(ui.Panel([ui.Label('Max: ' + s.index_max.toFixed(3)), ui.Label('Std: ' + s.index_stdDev.toFixed(3))], ui.Panel.Layout.flow('horizontal')));
  });
}

function updateChart(idx) {
  var col = ee.ImageCollection.fromImages(ee.List.sequence(START_YEAR, END_YEAR).map(function(y) {
    return getAnnualImage(y, idx, geometry);
  }));
  // CHANGED: Used ee.Reducer.median()
  chartWidget.clear().add(ui.Chart.image.series(col, geometry, ee.Reducer.median(), 100)
    .setOptions({
      title: idx + ' History', 
      vAxis: {title: 'Value'}, 
      hAxis: {title: 'Year', format: 'yyyy', gridlines: {count: 5}}, 
      series: {0: {color: 'green', lineWidth: 2, pointsVisible: true}}
    }));
}

function exportTable() {
  if (!geometry) return alert('Draw ROI!');
  var idx = indexSelect.getValue();
  // CHANGED: Used ee.Reducer.median() and key index_median
  var features = ee.FeatureCollection(ee.List.sequence(START_YEAR, END_YEAR).map(function(y) {
    var val = getAnnualImage(y, idx, geometry).reduceRegion(ee.Reducer.median(), geometry, 100).get('index');
    return ee.Feature(null, {'year': y, 'value': val, 'indice': idx});
  }));
  Export.table.toDrive({collection: features, description: 'GEE_ChartData_' + idx, fileFormat: 'CSV'});
  alert('CSV Task started. Check Tasks tab.');
}

function exportRaster() {
  if (!geometry) return alert('Draw ROI!');
  var yr = yearSelect.getValue(); var idx = indexSelect.getValue(); var name = 'GEE_' + idx + '_' + yr;
  Export.image.toDrive({image: getAnnualImage(parseInt(yr), idx, geometry), description: name, scale: 30, region: geometry});
  alert('Map Export started.');
}

function exportBatchRaster() {
  if (!geometry) return alert('Draw ROI!');
  var idx = indexSelect.getValue();
  ee.List.sequence(START_YEAR, END_YEAR).getInfo().forEach(function(yr) {
    var name = 'GEE_' + idx + '_' + yr;
    Export.image.toDrive({image: getAnnualImage(yr, idx, geometry), description: name, scale: 30, region: geometry});
  });
  alert('Batch Exports started.');
}

// Stability handler
mainMap.drawingTools().onDraw(function(shape) { 
  if (shape) {
    geometry = shape; 
    shape.area().divide(10000).evaluate(function(a){ if (a) areaLabel.setValue('Area: ' + a.toFixed(2) + ' Ha'); });
    if (debounce) { ui.util.clearTimeout(debounce); }
    debounce = ui.util.setTimeout(function() { refreshApp(); }, 150);
  }
});

ui.root.clear(); 
ui.root.add(ui.SplitPanel(leftPanel, mapContainer, 'horizontal', false));