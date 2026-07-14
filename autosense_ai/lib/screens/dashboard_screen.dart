import 'dart:async';

import 'package:flutter/material.dart';

import '../models/car_data.dart';
import '../services/obd_service.dart';
import 'dtc_screen.dart';

class DashboardScreen extends StatefulWidget {
  final ObdService obdService;

  const DashboardScreen({super.key, required this.obdService});

  @override
  State<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends State<DashboardScreen> {
  CarData _data = const CarData();
  Timer? _timer;
  bool _reading = false;
  bool _fullMode = false; // toggle between fast (3 PID) and full (all PIDs)

  @override
  void initState() {
    super.initState();
    _startPolling();
  }

  void _startPolling() {
    _readData();
    _timer = Timer.periodic(const Duration(milliseconds: 1500), (_) {
      _readData();
    });
  }

  Future<void> _readData() async {
    if (_reading || !widget.obdService.isConnected) return;
    _reading = true;

    try {
      final live = _fullMode
          ? await widget.obdService.readFullLiveData()
          : await widget.obdService.readLiveData();

      if (mounted) {
        setState(() {
          if (_fullMode) {
            _data = live;
          } else {
            _data = _data.copyWith(
              rpm: live.rpm,
              speed: live.speed,
              coolantTemp: live.coolantTemp,
            );
          }
        });
      }
    } catch (_) {}
    finally {
      _reading = false;
    }
  }

  Future<void> _disconnect() async {
    _timer?.cancel();
    await widget.obdService.disconnect();
    if (mounted) Navigator.pop(context);
  }

  void _openDtcScreen({DtcCategory? filter}) {
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => DtcScreen(
          obdService: widget.obdService,
          initialFilter: filter,
        ),
      ),
    );
  }

  void _toggleMode() {
    setState(() => _fullMode = !_fullMode);
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Color _healthColor(int score) {
    if (score >= 80) return Colors.green;
    if (score >= 50) return Colors.orange;
    return Colors.red;
  }

  @override
  Widget build(BuildContext context) {
    final score = _data.healthScore;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Live Dashboard'),
        actions: [
          IconButton(
            icon: Icon(_fullMode ? Icons.speed : Icons.dashboard),
            tooltip: _fullMode ? 'Fast mode (3 PIDs)' : 'Full mode (all PIDs)',
            onPressed: _toggleMode,
          ),
          IconButton(
            icon: const Icon(Icons.bluetooth_disabled),
            tooltip: 'Disconnect',
            onPressed: _disconnect,
          ),
        ],
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // ── Health score ─────────────────────────────────────
            _HealthCard(score: score, color: _healthColor(score)),
            const SizedBox(height: 16),

            // ── Mode label ───────────────────────────────────────
            Padding(
              padding: const EdgeInsets.only(left: 4, bottom: 8),
              child: Text(
                _fullMode ? 'FULL SENSOR DATA' : 'CORE METRICS',
                style: TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w600,
                  color: Colors.grey.shade500,
                  letterSpacing: 1.2,
                ),
              ),
            ),

            // ── Core metrics (always shown) ──────────────────────
            GridView.count(
              crossAxisCount: 2,
              mainAxisSpacing: 10,
              crossAxisSpacing: 10,
              childAspectRatio: 1.35,
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              children: [
                _MetricCard(
                  label: 'RPM',
                  value: _data.rpm.toString(),
                  unit: 'rev/min',
                  icon: Icons.speed,
                  color: Colors.cyan,
                ),
                _MetricCard(
                  label: 'Speed',
                  value: _data.speed.toString(),
                  unit: 'km/h',
                  icon: Icons.av_timer,
                  color: Colors.tealAccent,
                ),
                _MetricCard(
                  label: 'Coolant Temp',
                  value: _data.coolantTemp.toString(),
                  unit: '°C',
                  icon: Icons.thermostat,
                  color: _data.coolantTemp > 110
                      ? Colors.redAccent
                      : Colors.orangeAccent,
                ),
                _MetricCard(
                  label: 'Engine Load',
                  value: _data.engineLoad.toStringAsFixed(1),
                  unit: '%',
                  icon: Icons.battery_charging_full,
                  color: _data.engineLoad > 85 ? Colors.redAccent : Colors.lightBlue,
                ),
              ],
            ),

            // ── Extended metrics (full mode) ─────────────────────
            if (_fullMode) ...[
              const SizedBox(height: 16),
              Padding(
                padding: const EdgeInsets.only(left: 4, bottom: 8),
                child: Text(
                  'FUEL SYSTEM',
                  style: TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w600,
                    color: Colors.grey.shade500,
                    letterSpacing: 1.2,
                  ),
                ),
              ),
              GridView.count(
                crossAxisCount: 2,
                mainAxisSpacing: 10,
                crossAxisSpacing: 10,
                childAspectRatio: 1.35,
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                children: [
                  _MetricCard(
                    label: 'Short Fuel Trim',
                    value: _data.shortTermFuelTrim.toStringAsFixed(1),
                    unit: '%',
                    icon: Icons.local_gas_station,
                    color: _fuelTrimColor(_data.shortTermFuelTrim),
                  ),
                  _MetricCard(
                    label: 'Long Fuel Trim',
                    value: _data.longTermFuelTrim.toStringAsFixed(1),
                    unit: '%',
                    icon: Icons.local_gas_station,
                    color: _fuelTrimColor(_data.longTermFuelTrim),
                  ),
                  _MetricCard(
                    label: 'Fuel Pressure',
                    value: _data.fuelPressure.toString(),
                    unit: 'kPa',
                    icon: Icons.compress,
                    color: Colors.amber,
                  ),
                  _MetricCard(
                    label: 'Throttle',
                    value: _data.throttlePosition.toStringAsFixed(1),
                    unit: '%',
                    icon: Icons.gamepad,
                    color: Colors.purpleAccent,
                  ),
                ],
              ),

              const SizedBox(height: 16),
              Padding(
                padding: const EdgeInsets.only(left: 4, bottom: 8),
                child: Text(
                  'AIR & IGNITION',
                  style: TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w600,
                    color: Colors.grey.shade500,
                    letterSpacing: 1.2,
                  ),
                ),
              ),
              GridView.count(
                crossAxisCount: 2,
                mainAxisSpacing: 10,
                crossAxisSpacing: 10,
                childAspectRatio: 1.35,
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                children: [
                  _MetricCard(
                    label: 'Intake Temp',
                    value: _data.intakeTemp.toString(),
                    unit: '°C',
                    icon: Icons.air,
                    color: Colors.lightBlue,
                  ),
                  _MetricCard(
                    label: 'MAP',
                    value: _data.intakeManifoldPressure.toString(),
                    unit: 'kPa',
                    icon: Icons.compress,
                    color: Colors.indigo.shade300,
                  ),
                  _MetricCard(
                    label: 'MAF Air Flow',
                    value: _data.mafAirFlow.toStringAsFixed(2),
                    unit: 'g/s',
                    icon: Icons.wind_power,
                    color: Colors.teal,
                  ),
                  _MetricCard(
                    label: 'Timing Advance',
                    value: _data.timingAdvance.toStringAsFixed(1),
                    unit: '° BTDC',
                    icon: Icons.timer,
                    color: Colors.deepOrange.shade300,
                  ),
                ],
              ),

              const SizedBox(height: 16),
              Padding(
                padding: const EdgeInsets.only(left: 4, bottom: 8),
                child: Text(
                  'O2 SENSOR (BANK 1)',
                  style: TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w600,
                    color: Colors.grey.shade500,
                    letterSpacing: 1.2,
                  ),
                ),
              ),
              GridView.count(
                crossAxisCount: 2,
                mainAxisSpacing: 10,
                crossAxisSpacing: 10,
                childAspectRatio: 1.35,
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                children: [
                  _MetricCard(
                    label: 'O2 Voltage',
                    value: _data.o2Voltage.toStringAsFixed(3),
                    unit: 'V',
                    icon: Icons.electric_bolt,
                    color: Colors.yellow.shade600,
                  ),
                  _MetricCard(
                    label: 'O2 Fuel Trim',
                    value: _data.o2ShortTermFuelTrim.toStringAsFixed(1),
                    unit: '%',
                    icon: Icons.tune,
                    color: _fuelTrimColor(_data.o2ShortTermFuelTrim),
                  ),
                ],
              ),
            ],

            // ── Scan shortcuts ───────────────────────────────────
            const SizedBox(height: 20),
            Padding(
              padding: const EdgeInsets.only(left: 4, bottom: 8),
              child: Text(
                'DIAGNOSTICS',
                style: TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w600,
                  color: Colors.grey.shade500,
                  letterSpacing: 1.2,
                ),
              ),
            ),
            _ScanButton(
              icon: Icons.engineering,
              label: 'Engine Scan',
              subtitle: 'Stored, pending & permanent engine codes',
              color: Colors.cyan,
              onTap: () => _openDtcScreen(filter: DtcCategory.engine),
            ),
            const SizedBox(height: 8),
            _ScanButton(
              icon: Icons.settings,
              label: 'Transmission Scan',
              subtitle: 'Shift solenoids, torque converter, gear ratio',
              color: Colors.amber,
              onTap: () => _openDtcScreen(filter: DtcCategory.transmission),
            ),
            const SizedBox(height: 8),
            _ScanButton(
              icon: Icons.manage_search,
              label: 'Full Vehicle Scan',
              subtitle: 'All systems — engine, trans, body, network',
              color: Colors.tealAccent,
              onTap: () => _openDtcScreen(),
            ),
            const SizedBox(height: 24),
          ],
        ),
      ),
    );
  }

  Color _fuelTrimColor(double value) {
    final abs = value.abs();
    if (abs < 10) return Colors.green;
    if (abs < 20) return Colors.orange;
    return Colors.redAccent;
  }
}

// ═══════════════════════════════════════════════════════════════════════
// Widgets
// ═══════════════════════════════════════════════════════════════════════

class _HealthCard extends StatelessWidget {
  final int score;
  final Color color;

  const _HealthCard({required this.score, required this.color});

  @override
  Widget build(BuildContext context) {
    return Card(
      color: color.withValues(alpha: 0.15),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 18),
        child: Row(
          children: [
            Icon(Icons.favorite, color: color, size: 36),
            const SizedBox(width: 16),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Car Health Score',
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                  const SizedBox(height: 4),
                  ClipRRect(
                    borderRadius: BorderRadius.circular(4),
                    child: LinearProgressIndicator(
                      value: score / 100,
                      minHeight: 8,
                      backgroundColor: Colors.white12,
                      valueColor: AlwaysStoppedAnimation(color),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(width: 16),
            Text(
              '$score',
              style: Theme.of(context)
                  .textTheme
                  .headlineMedium
                  ?.copyWith(color: color, fontWeight: FontWeight.bold),
            ),
          ],
        ),
      ),
    );
  }
}

class _MetricCard extends StatelessWidget {
  final String label;
  final String value;
  final String unit;
  final IconData icon;
  final Color color;

  const _MetricCard({
    required this.label,
    required this.value,
    required this.unit,
    required this.icon,
    required this.color,
  });

  @override
  Widget build(BuildContext context) {
    return Card(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      color: const Color(0xFF1E1E2C),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Row(
              children: [
                Icon(icon, color: color, size: 20),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    label,
                    style: TextStyle(color: Colors.grey.shade400, fontSize: 12),
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ],
            ),
            FittedBox(
              fit: BoxFit.scaleDown,
              alignment: Alignment.bottomLeft,
              child: Text.rich(
                TextSpan(
                  text: value,
                  style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                        fontWeight: FontWeight.bold,
                        color: Colors.white,
                      ),
                  children: [
                    TextSpan(
                      text: '  $unit',
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                            color: Colors.grey,
                          ),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ScanButton extends StatelessWidget {
  final IconData icon;
  final String label;
  final String subtitle;
  final Color color;
  final VoidCallback onTap;

  const _ScanButton({
    required this.icon,
    required this.label,
    required this.subtitle,
    required this.color,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Card(
      color: const Color(0xFF1E1E2C),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      child: ListTile(
        contentPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
        leading: Container(
          padding: const EdgeInsets.all(10),
          decoration: BoxDecoration(
            color: color.withValues(alpha: 0.15),
            borderRadius: BorderRadius.circular(10),
          ),
          child: Icon(icon, color: color),
        ),
        title: Text(label, style: const TextStyle(fontWeight: FontWeight.w600)),
        subtitle: Text(subtitle, style: const TextStyle(color: Colors.grey, fontSize: 12)),
        trailing: Icon(Icons.chevron_right, color: color),
        onTap: onTap,
      ),
    );
  }
}
