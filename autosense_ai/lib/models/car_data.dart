/// Which system a DTC belongs to.
enum DtcCategory {
  engine('Engine / Powertrain'),
  transmission('Transmission'),
  body('Body'),
  network('Network / Comms');

  final String label;

  const DtcCategory(this.label);

  /// Determine category from a code like "P0301" or "U0100".
  static DtcCategory fromCode(String code) {
    if (code.startsWith('B')) return DtcCategory.body;
    if (code.startsWith('U')) return DtcCategory.network;
    if (code.startsWith('C')) return DtcCategory.body;
    if (code.startsWith('P')) {
      if (code.length >= 4) {
        final numeric = code.substring(1);
        final value = int.tryParse(numeric) ?? 0;
        if (value >= 700 && value <= 999) return DtcCategory.transmission;
      }
      return DtcCategory.engine;
    }
    return DtcCategory.engine;
  }
}

/// How the DTC was captured.
enum DtcType {
  stored('Stored'),
  pending('Pending'),
  permanent('Permanent');

  final String label;
  const DtcType(this.label);
}

/// A single diagnostic trouble code with metadata.
class DtcResult {
  final String code;
  final DtcType type;
  final DtcCategory category;
  final String description;

  const DtcResult({
    required this.code,
    required this.type,
    required this.category,
    required this.description,
  });
}

class CarData {
  // ── Core readings ──────────────────────────────────────────────────
  final int rpm;
  final int speed;
  final int coolantTemp;

  // ── Extended readings ──────────────────────────────────────────────
  final double engineLoad;        // %  (0–100)
  final int intakeTemp;           // °C
  final int intakeManifoldPressure; // kPa
  final double timingAdvance;     // ° before TDC
  final double mafAirFlow;        // g/s
  final double throttlePosition;  // %  (0–100)
  final double shortTermFuelTrim; // %  (–100 to +99.2)
  final double longTermFuelTrim;  // %  (–100 to +99.2)
  final double o2Voltage;         // V  (Bank 1 Sensor 1)
  final double o2ShortTermFuelTrim; // % (Bank 1 Sensor 1)
  final int fuelPressure;         // kPa

  // ── DTCs ───────────────────────────────────────────────────────────
  final List<String> dtcCodes;

  const CarData({
    this.rpm = 0,
    this.speed = 0,
    this.coolantTemp = 0,
    this.engineLoad = 0,
    this.intakeTemp = 0,
    this.intakeManifoldPressure = 0,
    this.timingAdvance = 0,
    this.mafAirFlow = 0,
    this.throttlePosition = 0,
    this.shortTermFuelTrim = 0,
    this.longTermFuelTrim = 0,
    this.o2Voltage = 0,
    this.o2ShortTermFuelTrim = 0,
    this.fuelPressure = 0,
    this.dtcCodes = const [],
  });

  CarData copyWith({
    int? rpm,
    int? speed,
    int? coolantTemp,
    double? engineLoad,
    int? intakeTemp,
    int? intakeManifoldPressure,
    double? timingAdvance,
    double? mafAirFlow,
    double? throttlePosition,
    double? shortTermFuelTrim,
    double? longTermFuelTrim,
    double? o2Voltage,
    double? o2ShortTermFuelTrim,
    int? fuelPressure,
    List<String>? dtcCodes,
  }) {
    return CarData(
      rpm: rpm ?? this.rpm,
      speed: speed ?? this.speed,
      coolantTemp: coolantTemp ?? this.coolantTemp,
      engineLoad: engineLoad ?? this.engineLoad,
      intakeTemp: intakeTemp ?? this.intakeTemp,
      intakeManifoldPressure: intakeManifoldPressure ?? this.intakeManifoldPressure,
      timingAdvance: timingAdvance ?? this.timingAdvance,
      mafAirFlow: mafAirFlow ?? this.mafAirFlow,
      throttlePosition: throttlePosition ?? this.throttlePosition,
      shortTermFuelTrim: shortTermFuelTrim ?? this.shortTermFuelTrim,
      longTermFuelTrim: longTermFuelTrim ?? this.longTermFuelTrim,
      o2Voltage: o2Voltage ?? this.o2Voltage,
      o2ShortTermFuelTrim: o2ShortTermFuelTrim ?? this.o2ShortTermFuelTrim,
      fuelPressure: fuelPressure ?? this.fuelPressure,
      dtcCodes: dtcCodes ?? this.dtcCodes,
    );
  }

  /// Health score: starts at 100, deducts for issues.
  int get healthScore {
    int score = 100;
    score -= dtcCodes.length * 20;
    if (coolantTemp > 110) score -= 10;
    if (engineLoad > 90) score -= 5;
    if (shortTermFuelTrim.abs() > 20) score -= 5;
    if (longTermFuelTrim.abs() > 20) score -= 5;
    return score.clamp(0, 100);
  }

  /// Fuel system status code → human label.
  static String describeFuelStatus(int status) {
    return switch (status) {
      0 => 'Off',
      1 => 'Open loop (cold)',
      2 => 'Closed loop (O2 sensor)',
      4 => 'Open loop (load/decel)',
      8 => 'Open loop (system fault)',
      16 => 'Closed loop (feedback fault)',
      _ => 'Unknown ($status)',
    };
  }

  /// Look up a human-readable description for any DTC code.
  static String describeDtc(String code) {
    return dtcDescriptions[code] ?? 'Unknown fault code';
  }

  // ═══════════════════════════════════════════════════════════════════
  // Master DTC dictionary
  // ═══════════════════════════════════════════════════════════════════

  static const Map<String, String> dtcDescriptions = {
    // ── Engine / Fuel / Air ──────────────────────────────────────────
    'P0100': 'Mass Air Flow Circuit Malfunction',
    'P0101': 'Mass Air Flow Circuit Range/Performance',
    'P0102': 'Mass Air Flow Circuit Low Input',
    'P0103': 'Mass Air Flow Circuit High Input',
    'P0104': 'Mass Air Flow Circuit Intermittent',
    'P0105': 'MAP/Barometric Pressure Circuit Malfunction',
    'P0106': 'MAP/Barometric Pressure Circuit Range/Performance',
    'P0107': 'MAP/Barometric Pressure Circuit Low Input',
    'P0108': 'MAP/Barometric Pressure Circuit High Input',
    'P0110': 'Intake Air Temperature Circuit Malfunction',
    'P0111': 'Intake Air Temperature Circuit Range/Performance',
    'P0112': 'Intake Air Temperature Circuit Low Input',
    'P0113': 'Intake Air Temperature Circuit High Input',
    'P0115': 'Engine Coolant Temp Circuit Malfunction',
    'P0116': 'Engine Coolant Temp Circuit Range/Performance',
    'P0117': 'Engine Coolant Temp Circuit Low Input',
    'P0118': 'Engine Coolant Temp Circuit High Input',
    'P0120': 'Throttle Position Sensor Circuit Malfunction',
    'P0121': 'Throttle Position Sensor Range/Performance',
    'P0122': 'Throttle Position Sensor Circuit Low Input',
    'P0123': 'Throttle Position Sensor Circuit High Input',
    'P0125': 'Insufficient Coolant Temp for Closed Loop',
    'P0128': 'Coolant Thermostat Below Regulating Temp',
    'P0130': 'O2 Sensor Circuit Malfunction (Bank 1 Sensor 1)',
    'P0131': 'O2 Sensor Circuit Low Voltage (Bank 1 Sensor 1)',
    'P0132': 'O2 Sensor Circuit High Voltage (Bank 1 Sensor 1)',
    'P0133': 'O2 Sensor Circuit Slow Response (Bank 1 Sensor 1)',
    'P0134': 'O2 Sensor Circuit No Activity (Bank 1 Sensor 1)',
    'P0135': 'O2 Sensor Heater Circuit Malfunction (Bank 1 Sensor 1)',
    'P0136': 'O2 Sensor Circuit Malfunction (Bank 1 Sensor 2)',
    'P0137': 'O2 Sensor Circuit Low Voltage (Bank 1 Sensor 2)',
    'P0138': 'O2 Sensor Circuit High Voltage (Bank 1 Sensor 2)',
    'P0139': 'O2 Sensor Circuit Slow Response (Bank 1 Sensor 2)',
    'P0140': 'O2 Sensor Circuit No Activity (Bank 1 Sensor 2)',
    'P0141': 'O2 Sensor Heater Circuit Malfunction (Bank 1 Sensor 2)',
    'P0150': 'O2 Sensor Circuit Malfunction (Bank 2 Sensor 1)',
    'P0151': 'O2 Sensor Circuit Low Voltage (Bank 2 Sensor 1)',
    'P0152': 'O2 Sensor Circuit High Voltage (Bank 2 Sensor 1)',
    'P0153': 'O2 Sensor Circuit Slow Response (Bank 2 Sensor 1)',
    'P0154': 'O2 Sensor Circuit No Activity (Bank 2 Sensor 1)',
    'P0155': 'O2 Sensor Heater Circuit Malfunction (Bank 2 Sensor 1)',
    'P0171': 'System Too Lean (Bank 1)',
    'P0172': 'System Too Rich (Bank 1)',
    'P0174': 'System Too Lean (Bank 2)',
    'P0175': 'System Too Rich (Bank 2)',

    // ── Injectors ────────────────────────────────────────────────────
    'P0200': 'Injector Circuit Malfunction',
    'P0201': 'Injector Circuit Malfunction – Cylinder 1',
    'P0202': 'Injector Circuit Malfunction – Cylinder 2',
    'P0203': 'Injector Circuit Malfunction – Cylinder 3',
    'P0204': 'Injector Circuit Malfunction – Cylinder 4',
    'P0205': 'Injector Circuit Malfunction – Cylinder 5',
    'P0206': 'Injector Circuit Malfunction – Cylinder 6',
    'P0207': 'Injector Circuit Malfunction – Cylinder 7',
    'P0208': 'Injector Circuit Malfunction – Cylinder 8',
    'P0215': 'Engine Shutoff Solenoid Malfunction',
    'P0216': 'Injection Timing Control Circuit Malfunction',
    'P0217': 'Engine Over-Temperature Condition',
    'P0218': 'Transmission Over-Temperature Condition',
    'P0219': 'Engine Over-Speed Condition',

    // ── Ignition / Misfire ───────────────────────────────────────────
    'P0300': 'Random/Multiple Cylinder Misfire Detected',
    'P0301': 'Cylinder 1 Misfire Detected',
    'P0302': 'Cylinder 2 Misfire Detected',
    'P0303': 'Cylinder 3 Misfire Detected',
    'P0304': 'Cylinder 4 Misfire Detected',
    'P0305': 'Cylinder 5 Misfire Detected',
    'P0306': 'Cylinder 6 Misfire Detected',
    'P0307': 'Cylinder 7 Misfire Detected',
    'P0308': 'Cylinder 8 Misfire Detected',
    'P0325': 'Knock Sensor 1 Circuit Malfunction (Bank 1)',
    'P0326': 'Knock Sensor 1 Circuit Range/Performance (Bank 1)',
    'P0327': 'Knock Sensor 1 Circuit Low Input (Bank 1)',
    'P0328': 'Knock Sensor 1 Circuit High Input (Bank 1)',
    'P0330': 'Knock Sensor 2 Circuit Malfunction (Bank 2)',
    'P0335': 'Crankshaft Position Sensor A Circuit Malfunction',
    'P0336': 'Crankshaft Position Sensor A Circuit Range/Performance',
    'P0340': 'Camshaft Position Sensor A Circuit Malfunction (Bank 1)',
    'P0341': 'Camshaft Position Sensor A Circuit Range/Performance',
    'P0345': 'Camshaft Position Sensor A Circuit Malfunction (Bank 2)',

    // ── EGR / Emissions ─────────────────────────────────────────────
    'P0400': 'Exhaust Gas Recirculation Flow Malfunction',
    'P0401': 'EGR Flow Insufficient Detected',
    'P0402': 'EGR Flow Excessive Detected',
    'P0403': 'EGR Circuit Malfunction',
    'P0404': 'EGR Circuit Range/Performance',
    'P0405': 'EGR Sensor A Circuit Low',
    'P0406': 'EGR Sensor A Circuit High',
    'P0410': 'Secondary Air Injection System Malfunction',
    'P0411': 'Secondary Air Injection System Incorrect Flow',
    'P0420': 'Catalyst System Efficiency Below Threshold (Bank 1)',
    'P0421': 'Warm Up Catalyst Efficiency Below Threshold (Bank 1)',
    'P0430': 'Catalyst System Efficiency Below Threshold (Bank 2)',
    'P0440': 'Evaporative Emission Control System Malfunction',
    'P0441': 'EVAP System Incorrect Purge Flow',
    'P0442': 'EVAP System Leak Detected (Small Leak)',
    'P0443': 'EVAP Purge Control Valve Circuit Malfunction',
    'P0446': 'EVAP Vent Control Circuit Malfunction',
    'P0449': 'EVAP Vent Valve/Solenoid Circuit Malfunction',
    'P0450': 'EVAP Emission System Pressure Sensor Malfunction',
    'P0451': 'EVAP Emission System Pressure Sensor Range/Performance',
    'P0452': 'EVAP Emission System Pressure Sensor Low Input',
    'P0453': 'EVAP Emission System Pressure Sensor High Input',
    'P0455': 'EVAP System Leak Detected (Large Leak)',
    'P0456': 'EVAP System Leak Detected (Very Small Leak)',

    // ── Vehicle Speed / Idle ─────────────────────────────────────────
    'P0500': 'Vehicle Speed Sensor Malfunction',
    'P0501': 'Vehicle Speed Sensor Range/Performance',
    'P0505': 'Idle Control System Malfunction',
    'P0506': 'Idle Control System RPM Lower Than Expected',
    'P0507': 'Idle Control System RPM Higher Than Expected',
    'P0510': 'Closed Throttle Position Switch Malfunction',
    'P0520': 'Engine Oil Pressure Sensor Circuit Malfunction',
    'P0521': 'Engine Oil Pressure Sensor Range/Performance',
    'P0522': 'Engine Oil Pressure Sensor Low Voltage',
    'P0523': 'Engine Oil Pressure Sensor High Voltage',
    'P0530': 'A/C Refrigerant Pressure Sensor Circuit Malfunction',

    // ── ECU / Communication ──────────────────────────────────────────
    'P0600': 'Serial Communication Link Malfunction',
    'P0601': 'Internal Control Module Memory Check Sum Error',
    'P0602': 'Control Module Programming Error',
    'P0603': 'Internal Control Module KAM Error',
    'P0604': 'Internal Control Module RAM Error',
    'P0605': 'Internal Control Module ROM Error',
    'P0606': 'ECM/PCM Processor Fault',

    // ═══════════════════════════════════════════════════════════════
    // TRANSMISSION  (P0700 – P0999)
    // ═══════════════════════════════════════════════════════════════
    'P0700': 'Transmission Control System Malfunction (MIL Request)',
    'P0701': 'Transmission Control System Range/Performance',
    'P0702': 'Transmission Control System Electrical',
    'P0703': 'Brake Switch B Circuit',
    'P0704': 'Clutch Switch Input Circuit Malfunction',
    'P0705': 'Transmission Range Sensor Circuit Malfunction (PRNDL)',
    'P0706': 'Transmission Range Sensor Circuit Range/Performance',
    'P0707': 'Transmission Range Sensor Circuit Low Input',
    'P0708': 'Transmission Range Sensor Circuit High Input',
    'P0710': 'Transmission Fluid Temperature Sensor Circuit Malfunction',
    'P0711': 'Transmission Fluid Temp Sensor Range/Performance',
    'P0712': 'Transmission Fluid Temp Sensor Circuit Low Input',
    'P0713': 'Transmission Fluid Temp Sensor Circuit High Input',
    'P0715': 'Input/Turbine Speed Sensor Circuit Malfunction',
    'P0716': 'Input/Turbine Speed Sensor Circuit Range/Performance',
    'P0717': 'Input/Turbine Speed Sensor Circuit No Signal',
    'P0718': 'Input/Turbine Speed Sensor Circuit Intermittent',
    'P0720': 'Output Speed Sensor Circuit Malfunction',
    'P0721': 'Output Speed Sensor Circuit Range/Performance',
    'P0722': 'Output Speed Sensor Circuit No Signal',
    'P0723': 'Output Speed Sensor Circuit Intermittent',
    'P0725': 'Engine Speed Input Circuit Malfunction',
    'P0726': 'Engine Speed Input Circuit Range/Performance',
    'P0727': 'Engine Speed Input Circuit No Signal',
    'P0730': 'Incorrect Gear Ratio',
    'P0731': 'Gear 1 Incorrect Ratio',
    'P0732': 'Gear 2 Incorrect Ratio',
    'P0733': 'Gear 3 Incorrect Ratio',
    'P0734': 'Gear 4 Incorrect Ratio',
    'P0735': 'Gear 5 Incorrect Ratio',
    'P0736': 'Reverse Incorrect Ratio',
    'P0740': 'Torque Converter Clutch Circuit Malfunction',
    'P0741': 'Torque Converter Clutch Solenoid Performance/Stuck Off',
    'P0742': 'Torque Converter Clutch Circuit Stuck On',
    'P0743': 'Torque Converter Clutch Circuit Electrical',
    'P0744': 'Torque Converter Clutch Circuit Intermittent',
    'P0745': 'Pressure Control Solenoid A Malfunction',
    'P0746': 'Pressure Control Solenoid A Performance/Stuck Off',
    'P0747': 'Pressure Control Solenoid A Stuck On',
    'P0748': 'Pressure Control Solenoid A Electrical',
    'P0750': 'Shift Solenoid A Malfunction',
    'P0751': 'Shift Solenoid A Performance/Stuck Off',
    'P0752': 'Shift Solenoid A Stuck On',
    'P0753': 'Shift Solenoid A Electrical',
    'P0755': 'Shift Solenoid B Malfunction',
    'P0756': 'Shift Solenoid B Performance/Stuck Off',
    'P0757': 'Shift Solenoid B Stuck On',
    'P0758': 'Shift Solenoid B Electrical',
    'P0760': 'Shift Solenoid C Malfunction',
    'P0761': 'Shift Solenoid C Performance/Stuck Off',
    'P0762': 'Shift Solenoid C Stuck On',
    'P0763': 'Shift Solenoid C Electrical',
    'P0765': 'Shift Solenoid D Malfunction',
    'P0766': 'Shift Solenoid D Performance/Stuck Off',
    'P0767': 'Shift Solenoid D Stuck On',
    'P0768': 'Shift Solenoid D Electrical',
    'P0770': 'Shift Solenoid E Malfunction',
    'P0771': 'Shift Solenoid E Performance/Stuck Off',
    'P0772': 'Shift Solenoid E Stuck On',
    'P0773': 'Shift Solenoid E Electrical',
    'P0775': 'Pressure Control Solenoid B Malfunction',
    'P0776': 'Pressure Control Solenoid B Performance/Stuck Off',
    'P0777': 'Pressure Control Solenoid B Stuck On',
    'P0778': 'Pressure Control Solenoid B Electrical',
    'P0780': 'Shift Malfunction',
    'P0781': '1-2 Shift Malfunction',
    'P0782': '2-3 Shift Malfunction',
    'P0783': '3-4 Shift Malfunction',
    'P0784': '4-5 Shift Malfunction',
    'P0785': 'Shift/Timing Solenoid Malfunction',
    'P0786': 'Shift/Timing Solenoid Range/Performance',
    'P0787': 'Shift/Timing Solenoid Low',
    'P0788': 'Shift/Timing Solenoid High',
    'P0790': 'Normal/Performance Switch Circuit Malfunction',
    'P0795': 'Pressure Control Solenoid C Malfunction',
    'P0796': 'Pressure Control Solenoid C Performance/Stuck Off',
    'P0797': 'Pressure Control Solenoid C Stuck On',
    'P0798': 'Pressure Control Solenoid C Electrical',
    'P0800': 'Transfer Case Control System (MIL Request)',
    'P0801': 'Reverse Inhibit Control Circuit Malfunction',
    'P0802': 'Transmission Control System MIL Request Circuit/Open',
    'P0803': '1-4 Upshift (Skip Shift) Solenoid Circuit Malfunction',
    'P0804': '1-4 Upshift (Skip Shift) Lamp Circuit Malfunction',
    'P0805': 'Clutch Position Sensor Circuit Malfunction',
    'P0806': 'Clutch Position Sensor Range/Performance',
    'P0810': 'Clutch Position Control Error',
    'P0815': 'Upshift Switch Circuit Malfunction',
    'P0816': 'Downshift Switch Circuit Malfunction',
    'P0820': 'Gear Lever X-Y Position Sensor Circuit Malfunction',
    'P0840': 'Transmission Fluid Pressure Sensor A Circuit',
    'P0841': 'Transmission Fluid Pressure Sensor A Range/Performance',
    'P0845': 'Transmission Fluid Pressure Sensor B Circuit',
    'P0846': 'Transmission Fluid Pressure Sensor B Range/Performance',
    'P0850': 'Park/Neutral Switch Input Circuit Malfunction',
    'P0851': 'Park/Neutral Switch Input Circuit Low',
    'P0856': 'Traction Control Input Signal Malfunction',
    'P0860': 'Gear Shift Module Communication Circuit',
    'P0865': 'Gear Shift Module Communication Circuit Low',
    'P0870': 'Transmission Fluid Pressure Sensor C Circuit',
    'P0871': 'Transmission Fluid Pressure Sensor C Range/Performance',
    'P0880': 'TCM Power Input Signal',
    'P0885': 'TCM Power Relay Control Circuit/Open',
    'P0890': 'TCM Power Relay Sense Circuit',
    'P0900': 'Clutch Actuator Circuit/Open',
    'P0901': 'Clutch Actuator Circuit Range/Performance',
    'P0910': 'Gate Select Actuator Circuit/Open',
    'P0920': 'Gear Shift Forward Actuator Circuit/Open',
    'P0930': 'Gear Shift Reverse Actuator Circuit/Open',
    'P0960': 'Pressure Control Solenoid A Control Circuit/Open',
    'P0961': 'Pressure Control Solenoid A Control Circuit Range/Performance',
    'P0965': 'Pressure Control Solenoid B Control Circuit/Open',
    'P0966': 'Pressure Control Solenoid B Control Circuit Range/Performance',
    'P0970': 'Pressure Control Solenoid C Control Circuit/Open',
    'P0971': 'Pressure Control Solenoid C Control Circuit Range/Performance',

    // ── OBD Readiness ────────────────────────────────────────────────
    'P1000': 'OBD Systems Readiness Test Not Complete',

    // ── Network / Communication U-codes ──────────────────────────────
    'U0001': 'High Speed CAN Communication Bus',
    'U0002': 'High Speed CAN Communication Bus Performance',
    'U0100': 'Lost Communication with ECM/PCM A',
    'U0101': 'Lost Communication with TCM',
    'U0102': 'Lost Communication with Transfer Case Control Module',
    'U0103': 'Lost Communication with Gear Shift Module',
    'U0104': 'Lost Communication with Cruise Control Module',
    'U0106': 'Lost Communication with Glow Plug Control Module',
    'U0107': 'Lost Communication with Throttle Actuator Control Module',
    'U0109': 'Lost Communication with Fuel Pump Control Module',
    'U0110': 'Lost Communication with Drive Motor Control Module',
    'U0121': 'Lost Communication with ABS Control Module',
    'U0122': 'Lost Communication with Vehicle Dynamics Control Module',
    'U0126': 'Lost Communication with Steering Angle Sensor Module',
    'U0128': 'Lost Communication with Park Brake Control Module',
    'U0129': 'Lost Communication with Brake System Control Module',
    'U0131': 'Lost Communication with Power Steering Control Module',
    'U0140': 'Lost Communication with Body Control Module',
    'U0141': 'Lost Communication with Body Control Module A',
    'U0151': 'Lost Communication with Restraints Control Module',
    'U0155': 'Lost Communication with Instrument Panel Cluster',
    'U0164': 'Lost Communication with HVAC Control Module',
    'U0184': 'Lost Communication with Radio/Audio Module',
    'U0199': 'Lost Communication with Door Control Module A',
    'U0300': 'Internal Control Module Software Incompatibility',
    'U0401': 'Invalid Data Received from ECM/PCM',
    'U0402': 'Invalid Data Received from TCM',

    // ── Body B-codes ─────────────────────────────────────────────────
    'B0001': 'Driver Frontal Stage 1 Deployment Control',
    'B0002': 'Driver Frontal Stage 2 Deployment Control',
    'B0010': 'Driver Frontal Stage 1 Deployment Loop',
    'B0020': 'Passenger Frontal Stage 1 Deployment Loop',
    'B0050': 'Passenger Frontal Stage 1 Deployment Control',
    'B0100': 'Electronic Frontal Sensor 1 Malfunction',
    'B1000': 'ECU Malfunction (Body)',
    'B1200': 'Climate Control Sensor Malfunction',
    'B1318': 'Battery Voltage Low',
    'B1342': 'ECU Fault (PCM)',
    'B1600': 'PATS Key Not Programmed',
    'B1601': 'PATS Received Incorrect Key Code',
    'B2100': 'Door Lock Motor Circuit Failure',
    'B2900': 'Sensor Supply Voltage 1 Circuit Malfunction',
  };
}
