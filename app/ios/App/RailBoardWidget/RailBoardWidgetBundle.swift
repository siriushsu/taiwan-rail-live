//
//  RailBoardWidgetBundle.swift
//  RailBoardWidget
//
//  Created by 許翔 on 2026/7/29.
//

import WidgetKit
import SwiftUI

@main
struct RailBoardWidgetBundle: WidgetBundle {
    var body: some Widget {
        RailBoardWidget()
        RailFollowActivityWidget()
        MetroBoardWidget()
        MixedBoardWidget()
        MetroWaitActivityWidget()
        TraWaitActivityWidget()
    }
}
