import 'package:flutter/material.dart';

import 'screens/bluetooth_screen.dart';
import 'services/obd_service.dart';

void main() {
  runApp(const AutoSenseApp());
}

class AutoSenseApp extends StatelessWidget {
  const AutoSenseApp({super.key});

  @override
  Widget build(BuildContext context) {
    final obdService = ObdService();

    return MaterialApp(
      title: 'AutoSense AI',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        brightness: Brightness.dark,
        scaffoldBackgroundColor: const Color(0xFF121218),
        colorScheme: ColorScheme.fromSeed(
          seedColor: Colors.cyan,
          brightness: Brightness.dark,
        ),
        appBarTheme: const AppBarTheme(
          backgroundColor: Color(0xFF1A1A24),
          centerTitle: true,
          elevation: 0,
        ),
        cardTheme: CardThemeData(
          color: const Color(0xFF1E1E2C),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16),
          ),
          elevation: 0,
        ),
        filledButtonTheme: FilledButtonThemeData(
          style: FilledButton.styleFrom(
            padding: const EdgeInsets.symmetric(vertical: 14),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(12),
            ),
          ),
        ),
      ),
      home: BluetoothScreen(obdService: obdService),
    );
  }
}
