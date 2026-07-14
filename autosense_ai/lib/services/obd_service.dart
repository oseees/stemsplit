import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_bluetooth_serial/flutter_bluetooth_serial.dart';

import '../models/car_data.dart';

class ObdService {
  BluetoothConnection? _connection;
  bool _isConnected = false;
  final StringBuffer _buffer = StringBuffer();

  bool get isConnected => _isConnected;

  // ── Bluetooth discovery ──────────────────────────────────────────────

  Future<List<BluetoothDevice>> scanDevices() async {
    return FlutterBluetoothSerial.instance.getBondedDevices();
  }

  // ── Connect / disconnect ─────────────────────────────────────────────

  Future<bool> connect(BluetoothDevice device) async {
    try {
      _connection = await BluetoothConnection.toAddress(device.address);
      _isConnected = true;

      _connection!.input?.listen(
        (data) => _buffer.write(String.fromCharCodes(data)),
        onDone: () => _isConnected = false,
      );

      await _initElm();
      return true;
    } catch (e) {
      _isConnected = false;
      return false;
    }
  }

  Future<void> disconnect() async {
    try {
      await _connection?.close();
    } catch (_) {}
    _connection = null;
    _isConnected = false;
  }

  // ── ELM327 initialisation ────────────────────────────────────────────

  Future<void> _initElm() async {
    await _sendCommand('ATZ', delayMs: 1500);
    await _sendCommand('ATE0', delayMs: 500);
    await _sendCommand('ATL0', delayMs: 500);
    await _sendCommand('ATS0', delayMs: 500);
    await _sendCommand('ATH0', delayMs: 500);
    await _sendCommand('ATSP0', delayMs: 500);
  }

  // ── Raw command I/O ──────────────────────────────────────────────────

  Future<String> _sendCommand(String cmd, {int delayMs = 300}) async {
    if (_connection == null || !_isConnected) return '';

    _buffer.clear();
    _connection!.output.add(Uint8List.fromList(utf8.encode('$cmd\r')));
    await _connection!.output.allSent;
    await Future.delayed(Duration(milliseconds: delayMs));

    final raw = _buffer.toString().trim();
    _buffer.clear();
    return raw;
  }

  // ── Live PID reads ───────────────────────────────────────────────────

  /// 010C — RPM: ((A*256)+B)/4
  Future<int> readRpm() async {
    final bytes = _parseResponse(await _sendCommand('010C'), expectedPid: '0C');
    if (bytes == null || bytes.length < 2) return 0;
    return ((bytes[0] * 256) + bytes[1]) ~/ 4;
  }

  /// 010D — Vehicle speed: A km/h
  Future<int> readSpeed() async {
    final bytes = _parseResponse(await _sendCommand('010D'), expectedPid: '0D');
    if (bytes == null || bytes.isEmpty) return 0;
    return bytes[0];
  }

  /// 0105 — Coolant temp: A-40 °C
  Future<int> readCoolantTemp() async {
    final bytes = _parseResponse(await _sendCommand('0105'), expectedPid: '05');
    if (bytes == null || bytes.isEmpty) return 0;
    return bytes[0] - 40;
  }

  /// 0104 — Calculated engine load: A*100/255 %
  Future<double> readEngineLoad() async {
    final bytes = _parseResponse(await _sendCommand('0104'), expectedPid: '04');
    if (bytes == null || bytes.isEmpty) return 0;
    return bytes[0] * 100.0 / 255.0;
  }

  /// 010F — Intake air temp: A-40 °C
  Future<int> readIntakeTemp() async {
    final bytes = _parseResponse(await _sendCommand('010F'), expectedPid: '0F');
    if (bytes == null || bytes.isEmpty) return 0;
    return bytes[0] - 40;
  }

  /// 010B — Intake manifold absolute pressure: A kPa
  Future<int> readIntakeManifoldPressure() async {
    final bytes = _parseResponse(await _sendCommand('010B'), expectedPid: '0B');
    if (bytes == null || bytes.isEmpty) return 0;
    return bytes[0];
  }

  /// 010E — Timing advance: A/2 - 64 degrees
  Future<double> readTimingAdvance() async {
    final bytes = _parseResponse(await _sendCommand('010E'), expectedPid: '0E');
    if (bytes == null || bytes.isEmpty) return 0;
    return bytes[0] / 2.0 - 64.0;
  }

  /// 0110 — MAF air flow rate: ((A*256)+B)/100 g/s
  Future<double> readMafAirFlow() async {
    final bytes = _parseResponse(await _sendCommand('0110'), expectedPid: '10');
    if (bytes == null || bytes.length < 2) return 0;
    return ((bytes[0] * 256) + bytes[1]) / 100.0;
  }

  /// 0111 — Throttle position: A*100/255 %
  Future<double> readThrottlePosition() async {
    final bytes = _parseResponse(await _sendCommand('0111'), expectedPid: '11');
    if (bytes == null || bytes.isEmpty) return 0;
    return bytes[0] * 100.0 / 255.0;
  }

  /// 0106 — Short term fuel trim (Bank 1): (A-128)*100/128 %
  Future<double> readShortTermFuelTrim() async {
    final bytes = _parseResponse(await _sendCommand('0106'), expectedPid: '06');
    if (bytes == null || bytes.isEmpty) return 0;
    return (bytes[0] - 128) * 100.0 / 128.0;
  }

  /// 0107 — Long term fuel trim (Bank 1): (A-128)*100/128 %
  Future<double> readLongTermFuelTrim() async {
    final bytes = _parseResponse(await _sendCommand('0107'), expectedPid: '07');
    if (bytes == null || bytes.isEmpty) return 0;
    return (bytes[0] - 128) * 100.0 / 128.0;
  }

  /// 0114 — O2 Sensor (Bank 1 Sensor 1): voltage = A/200, STFT = (B-128)*100/128
  Future<(double voltage, double stft)> readO2Sensor() async {
    final bytes = _parseResponse(await _sendCommand('0114'), expectedPid: '14');
    if (bytes == null || bytes.length < 2) return (0.0, 0.0);
    final voltage = bytes[0] / 200.0;
    final stft = (bytes[1] - 128) * 100.0 / 128.0;
    return (voltage, stft);
  }

  /// 010A — Fuel pressure: A*3 kPa
  Future<int> readFuelPressure() async {
    final bytes = _parseResponse(await _sendCommand('010A'), expectedPid: '0A');
    if (bytes == null || bytes.isEmpty) return 0;
    return bytes[0] * 3;
  }

  /// 0103 — Fuel system status
  Future<int> readFuelSystemStatus() async {
    final bytes = _parseResponse(await _sendCommand('0103'), expectedPid: '03');
    if (bytes == null || bytes.isEmpty) return 0;
    return bytes[0];
  }

  /// Read core live data (fast — 3 PIDs).
  Future<CarData> readLiveData() async {
    final rpm = await readRpm();
    final speed = await readSpeed();
    final coolant = await readCoolantTemp();
    return CarData(rpm: rpm, speed: speed, coolantTemp: coolant);
  }

  /// Read full live data (all PIDs — slower but complete).
  Future<CarData> readFullLiveData() async {
    final rpm = await readRpm();
    final speed = await readSpeed();
    final coolant = await readCoolantTemp();
    final load = await readEngineLoad();
    final intakeTemp = await readIntakeTemp();
    final map = await readIntakeManifoldPressure();
    final timing = await readTimingAdvance();
    final maf = await readMafAirFlow();
    final throttle = await readThrottlePosition();
    final stft = await readShortTermFuelTrim();
    final ltft = await readLongTermFuelTrim();
    final o2 = await readO2Sensor();
    final fuelPressure = await readFuelPressure();

    return CarData(
      rpm: rpm,
      speed: speed,
      coolantTemp: coolant,
      engineLoad: load,
      intakeTemp: intakeTemp,
      intakeManifoldPressure: map,
      timingAdvance: timing,
      mafAirFlow: maf,
      throttlePosition: throttle,
      shortTermFuelTrim: stft,
      longTermFuelTrim: ltft,
      o2Voltage: o2.$1,
      o2ShortTermFuelTrim: o2.$2,
      fuelPressure: fuelPressure,
    );
  }

  // ── DTC reads ────────────────────────────────────────────────────────

  Future<List<String>> readStoredDtc() async {
    final response = await _sendCommand('03', delayMs: 1500);
    return _parseDtcResponse(response, responseHeader: '43');
  }

  Future<List<String>> readPendingDtc() async {
    final response = await _sendCommand('07', delayMs: 1500);
    return _parseDtcResponse(response, responseHeader: '47');
  }

  Future<List<String>> readPermanentDtc() async {
    final response = await _sendCommand('0A', delayMs: 1500);
    return _parseDtcResponse(response, responseHeader: '4A');
  }

  Future<bool> clearDtcCodes() async {
    final response = await _sendCommand('04', delayMs: 2000);
    return !response.contains('ERROR') && !response.contains('NO DATA');
  }

  Future<List<DtcResult>> readAllDtc() async {
    final results = <DtcResult>[];

    final stored = await readStoredDtc();
    for (final code in stored) {
      results.add(DtcResult(
        code: code,
        type: DtcType.stored,
        category: DtcCategory.fromCode(code),
        description: CarData.describeDtc(code),
      ));
    }

    final pending = await readPendingDtc();
    for (final code in pending) {
      if (stored.contains(code)) continue;
      results.add(DtcResult(
        code: code,
        type: DtcType.pending,
        category: DtcCategory.fromCode(code),
        description: CarData.describeDtc(code),
      ));
    }

    final permanent = await readPermanentDtc();
    for (final code in permanent) {
      if (stored.contains(code) || pending.contains(code)) continue;
      results.add(DtcResult(
        code: code,
        type: DtcType.permanent,
        category: DtcCategory.fromCode(code),
        description: CarData.describeDtc(code),
      ));
    }

    return results;
  }

  // ── Response parsing ─────────────────────────────────────────────────

  List<int>? _parseResponse(String raw, {required String expectedPid}) {
    final clean = raw
        .replaceAll('>', '')
        .replaceAll('SEARCHING...', '')
        .replaceAll('NO DATA', '')
        .trim();

    if (clean.isEmpty || clean.contains('NO DATA') || clean.contains('ERROR')) {
      return null;
    }

    final hex = clean.replaceAll(RegExp(r'\s+'), '');
    final marker = '41${expectedPid.toUpperCase()}';
    final idx = hex.indexOf(marker);
    if (idx == -1) return null;

    final dataHex = hex.substring(idx + marker.length);
    if (dataHex.isEmpty) return null;

    final bytes = <int>[];
    for (var i = 0; i + 1 < dataHex.length; i += 2) {
      final value = int.tryParse(dataHex.substring(i, i + 2), radix: 16);
      if (value != null) bytes.add(value);
    }
    return bytes;
  }

  List<String> _parseDtcResponse(String raw, {required String responseHeader}) {
    final clean = raw
        .replaceAll('>', '')
        .replaceAll('SEARCHING...', '')
        .replaceAll('NO DATA', '')
        .trim();

    if (clean.isEmpty || clean.contains('NO DATA')) return [];

    final hex = clean.replaceAll(RegExp(r'\s+'), '');
    final idx = hex.indexOf(responseHeader);
    if (idx == -1) return [];

    final dataHex = hex.substring(idx + responseHeader.length);
    final codes = <String>[];

    for (var i = 0; i + 3 < dataHex.length; i += 4) {
      final highByte = int.tryParse(dataHex.substring(i, i + 2), radix: 16);
      final lowByte = int.tryParse(dataHex.substring(i + 2, i + 4), radix: 16);
      if (highByte == null || lowByte == null) continue;
      if (highByte == 0 && lowByte == 0) continue;

      final code = _decodeDtc(highByte, lowByte);
      if (code != null) codes.add(code);
    }

    return codes;
  }

  String? _decodeDtc(int highByte, int lowByte) {
    const prefixes = ['P', 'C', 'B', 'U'];
    final prefixIndex = (highByte >> 6) & 0x03;
    final prefix = prefixes[prefixIndex];

    final digit1 = (highByte >> 4) & 0x03;
    final digit2 = highByte & 0x0F;
    final digit3 = (lowByte >> 4) & 0x0F;
    final digit4 = lowByte & 0x0F;

    return '$prefix$digit1${digit2.toRadixString(16).toUpperCase()}'
        '${digit3.toRadixString(16).toUpperCase()}'
        '${digit4.toRadixString(16).toUpperCase()}';
  }
}
