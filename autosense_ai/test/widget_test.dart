import 'package:flutter_test/flutter_test.dart';
import 'package:autosense_ai/main.dart';

void main() {
  testWidgets('App launches smoke test', (WidgetTester tester) async {
    await tester.pumpWidget(const AutoSenseApp());
    expect(find.text('AutoSense AI'), findsOneWidget);
  });
}
